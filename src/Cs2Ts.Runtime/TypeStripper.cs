using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime;

/// <summary>
/// Turns a plugin's TypeScript into JavaScript by erasing its types, using
/// ts-blank-space and the official TypeScript parser running inside V8.
///
/// The server never type-checks. Checking is the author's tsconfig's job (see
/// <c>templates/tsconfig.json</c>); all that happens here is erasure, plus refusing the
/// handful of constructs that erasure cannot express.
/// </summary>
public sealed class TypeStripper : IDisposable
{
    private const string ResourceName = "Cs2Ts.Runtime.stripper.js.gz";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly V8ScriptEngine _engine;
    private readonly ScriptObject _strip;
    private readonly Lock _gate = new();
    private bool _disposed;

    private TypeStripper(V8ScriptEngine engine, ScriptObject strip, TimeSpan loadTime)
    {
        _engine = engine;
        _strip = strip;
        LoadTime = loadTime;
    }

    /// <summary>
    /// How long the bundled parser took to decompress and evaluate. Paid once per
    /// process, during plugin load rather than during a tick.
    /// </summary>
    public TimeSpan LoadTime { get; }

    /// <summary>
    /// Creates the stripper on its own engine over the shared runtime.
    ///
    /// The engine is dedicated for two reasons. Hot reload disposes and rebuilds a
    /// plugin's engine (there is no way to unload a module from a V8 context), and
    /// re-evaluating three megabytes of parser on every reload would make reload feel
    /// broken. And a plugin's global object stays clean: scripts never see the
    /// TypeScript compiler sitting next to their own code.
    ///
    /// Sharing the <see cref="V8Runtime"/> means all engines share one isolate, so the
    /// parser is resident once no matter how many plugins are loaded.
    /// </summary>
    public static TypeStripper Create(V8Runtime runtime)
    {
        ArgumentNullException.ThrowIfNull(runtime);

        var started = Stopwatch.GetTimestamp();
        var engine = runtime.CreateScriptEngine("cs2ts-stripper");
        try
        {
            engine.Execute(new DocumentInfo("cs2ts:stripper.js"), ReadBundle());

            if (engine.Script.__cs2ts_strip is not ScriptObject strip)
            {
                throw new InvalidOperationException(
                    "The stripper bundle evaluated without installing __cs2ts_strip. " +
                    "It is probably stale — rebuild it with 'npm run build' in tools/stripper.");
            }

            return new TypeStripper(engine, strip, Stopwatch.GetElapsedTime(started));
        }
        catch
        {
            engine.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Strips one plugin file. <paramref name="fileName"/> is only ever used to label
    /// diagnostics, so it should read the way the author refers to the file.
    /// </summary>
    public StripResult Strip(string fileName, string source)
    {
        ArgumentException.ThrowIfNullOrEmpty(fileName);
        ArgumentNullException.ThrowIfNull(source);
        ObjectDisposedException.ThrowIf(_disposed, this);

        string json;
        lock (_gate)
        {
            // One engine backs every plugin's stripping, and loads can arrive from the
            // game thread and from a console command thread. ClearScript serialises
            // access itself, but the script keeps parser state in module scope between
            // calls, so overlapping calls would interleave inside that state.
            json = (string)_strip.InvokeAsFunction(fileName, source);
        }

        var payload = JsonSerializer.Deserialize<Payload>(json, JsonOptions)
            ?? throw new InvalidOperationException("The stripper returned no result.");

        if (payload.JavaScript is not null && payload.Diagnostics is not { Count: > 0 })
        {
            return StripResult.Stripped(fileName, payload.JavaScript);
        }

        var diagnostics = (payload.Diagnostics ?? [])
            .Select(d => new StripDiagnostic(fileName, d.Code, d.Message, d.Line, d.Column))
            .ToArray();

        return StripResult.Refused(fileName, diagnostics);
    }

    private static string ReadBundle()
    {
        using var packed = typeof(TypeStripper).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException(
                $"The embedded resource '{ResourceName}' is missing. Build it with " +
                "'npm ci && npm run build' in tools/stripper, then rebuild this project.");

        using var unpacked = new GZipStream(packed, CompressionMode.Decompress);
        using var reader = new StreamReader(unpacked);
        return reader.ReadToEnd();
    }

    /// <summary>Disposes the stripper's engine. The shared runtime is left alone.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _engine.Dispose();
    }

    private sealed record Payload(string? JavaScript, IReadOnlyList<PayloadDiagnostic>? Diagnostics);

    private sealed record PayloadDiagnostic(string Code, string Message, int Line, int Column);
}
