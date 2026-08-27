using System.Runtime.InteropServices;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime;

/// <summary>
/// Loads ClearScript's native V8 with RTLD_DEEPBIND before ClearScript's own loader
/// gets to it.
///
/// The CS2 server already has Valve's V8 11.9 in the global lookup scope: Metamod's
/// load pulls libv8.so there, well before coreclr starts (measured with
/// LD_DEBUG=scopes). ClearScriptV8.linux-x64.so statically links V8 14.7 but exports
/// all 58k v8:: symbols at default visibility, routes 41k of its own calls through the
/// PLT, and is not built with -Bsymbolic. Without DEEPBIND those call sites resolve
/// against the global scope first and land in Valve's V8 — confirmed in the control
/// run, which aborted inside Valve's libv8_libbase.so with
/// "Wrong initialization order: from 4 to 5, expected to 1!".
///
/// DEEPBIND puts the object's own scope ahead of the global one, which fits this case
/// exactly: the library imports no v8:: symbol (0 undefined), so preferring its own
/// definitions costs nothing.
///
/// The flags only take effect if they are applied to the file ClearScript actually
/// opens. The host loads plugin assemblies from memory, so Assembly.Location is blank,
/// ClearScript's disk search finds nothing, and P/Invoke resolution answers with a copy
/// under a temp directory that the preload never touched. Claiming that resolution is
/// therefore not an optimisation — without it the preload is dead weight and the server
/// aborts.
/// </summary>
public static class V8Bootstrap
{
    private const int RtldNow = 0x00002;
    private const int RtldDeepBind = 0x00008;
    private const string NativeName = "ClearScriptV8.linux-x64.so";

    private static readonly Lock InstallGate = new();
    private static bool? _installed;

    [DllImport("libc", EntryPoint = "dlopen", CharSet = CharSet.Ansi)]
    private static extern IntPtr DlOpen(string fileName, int flags);

    [DllImport("libc", EntryPoint = "dlerror")]
    private static extern IntPtr DlError();

    /// <summary>
    /// Mirrors ClearScript's V8Proxy.GetDirPaths so the preload targets the file
    /// ClearScript will actually dlopen. Guessing the plugin directory is not enough:
    /// the host shadow-copies plugin assemblies to a temp directory, and ClearScript
    /// resolves the native library relative to its own assembly, not to the plugin.
    /// glibc keys dlopen on the file rather than the spelling of the path, so hitting
    /// the same file is what matters.
    /// </summary>
    internal static IEnumerable<string> CandidatePaths(string pluginDirectory)
    {
        var location = typeof(V8ScriptEngine).Assembly.Location;
        if (!string.IsNullOrWhiteSpace(location))
        {
            var dir = Path.GetDirectoryName(location);
            if (dir is not null)
            {
                yield return Path.Combine(dir, "runtimes", "linux-x64", "native", NativeName);
                yield return Path.Combine(dir, NativeName);
            }
        }

        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        if (!string.IsNullOrWhiteSpace(baseDir))
        {
            yield return Path.Combine(baseDir, NativeName);
        }

        // The host loads plugin assemblies from memory, so Assembly.Location is blank
        // and ClearScript's own search finds nothing on disk. Whatever puts a copy of
        // the native library under a temp directory is the file that actually gets
        // dlopen'd, so it is the only preload target that matters.
        foreach (var path in TempCopies())
        {
            yield return path;
        }

        yield return Path.Combine(pluginDirectory, "runtimes", "linux-x64", "native", NativeName);
        yield return Path.Combine(pluginDirectory, NativeName);
    }

    internal static IEnumerable<string> TempCopies()
    {
        string[] found;
        try
        {
            found = Directory.GetFiles(Path.GetTempPath(), NativeName, SearchOption.AllDirectories);
        }
        catch (Exception)
        {
            yield break;
        }

        foreach (var path in found)
        {
            yield return path;
        }
    }

    internal static string? Locate(string pluginDirectory)
    {
        return CandidatePaths(pluginDirectory).Distinct().FirstOrDefault(File.Exists);
    }

    /// <summary>
    /// Returns the dlopen handle, or IntPtr.Zero with <paramref name="error"/> set.
    /// </summary>
    internal static IntPtr LoadDeepBind(string soPath, out string? error)
    {
        error = null;
        var handle = DlOpen(soPath, RtldNow | RtldDeepBind);
        if (handle != IntPtr.Zero)
        {
            return handle;
        }

        var message = DlError();
        error = message == IntPtr.Zero ? "dlopen failed without a message" : Marshal.PtrToStringAnsi(message);
        return IntPtr.Zero;
    }

    /// <summary>
    /// Preloads with DEEPBIND and routes ClearScript's P/Invoke resolution to that
    /// handle. Both halves are required; either alone leaves the process aborting
    /// inside Valve's V8.
    ///
    /// Call this before touching any ClearScript type, from every code path that can be
    /// the first one to do so. Repeat calls are answered from the first result:
    /// SetDllImportResolver throws if it is given a second resolver for the same
    /// assembly, and hot reload makes a second call the normal case rather than a bug.
    /// </summary>
    public static bool Install(string pluginDirectory, Action<string> log)
    {
        lock (InstallGate)
        {
            if (_installed is { } already)
            {
                log($"bootstrap already installed ({(already ? "ok" : "failed")}); reusing that result");
                return already;
            }

            var result = InstallCore(pluginDirectory, log);
            _installed = result;
            return result;
        }
    }

    private static bool InstallCore(string pluginDirectory, Action<string> log)
    {
        var soPath = Locate(pluginDirectory);
        if (soPath is null)
        {
            log("bootstrap FAILED: ClearScriptV8.linux-x64.so not found on any candidate path");
            return false;
        }

        var handle = LoadDeepBind(soPath, out var error);
        if (handle == IntPtr.Zero)
        {
            log($"bootstrap FAILED: dlopen {soPath}: {error}");
            return false;
        }

        NativeLibrary.SetDllImportResolver(
            typeof(V8ScriptEngine).Assembly,
            (name, _, _) => name.Contains("ClearScriptV8", StringComparison.Ordinal) ? handle : IntPtr.Zero);

        log($"bootstrap ok deepbind={soPath} handle=0x{handle.ToInt64():x}");
        return true;
    }

    /// <summary>
    /// Checks that a plugin engine is running ClearScript's V8 and not the game's.
    ///
    /// The bootstrap's whole job is to send our calls to our own V8 rather than to the
    /// one already in the process. If it silently failed, scripts would run on Valve's
    /// V8 instead — and the symptom would not be a crash, it would be everything
    /// appearing to work while the isolation the design depends on does not exist.
    ///
    /// The two builds are years apart, so a feature that postdates the game's engine is
    /// a direct reading of which one compiled this. RegExp.escape landed in V8 13.5;
    /// the version CS2 ships is 11.9.
    /// </summary>
    /// <returns>True when the engine is newer than the game's, with no way to be sure which.</returns>
    public static bool LooksLikeOurV8(Microsoft.ClearScript.V8.V8ScriptEngine engine)
    {
        ArgumentNullException.ThrowIfNull(engine);

        try
        {
            return engine.Evaluate(
                """
                typeof RegExp.escape === "function" &&
                typeof Float16Array === "function" &&
                typeof Set.prototype.union === "function"
                """) is true;
        }
        catch
        {
            // A throw here is itself an answer of sorts, but not one worth crashing over:
            // the caller logs and carries on.
            return false;
        }
    }
}
