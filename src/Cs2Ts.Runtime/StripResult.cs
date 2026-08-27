namespace Cs2Ts.Runtime;

/// <summary>
/// The outcome of stripping one plugin file. Either there is JavaScript to run or there
/// are diagnostics explaining why there is not — never both, because partially stripped
/// output is what turns an author's mistake into a syntax error somewhere else.
/// </summary>
public sealed class StripResult
{
    private StripResult(string fileName, string? javaScript, IReadOnlyList<StripDiagnostic> diagnostics)
    {
        FileName = fileName;
        JavaScript = javaScript;
        Diagnostics = diagnostics;
    }

    /// <summary>The plugin file this result is about, as it was passed in.</summary>
    public string FileName { get; }

    /// <summary>
    /// The stripped source, or <c>null</c> if the file was refused. Types are replaced
    /// by spaces rather than removed, so every line and column matches the TypeScript
    /// the author wrote and a V8 stack trace needs no source map to be accurate.
    /// </summary>
    public string? JavaScript { get; }

    /// <summary>Why the file was refused. Empty when it was not.</summary>
    public IReadOnlyList<StripDiagnostic> Diagnostics { get; }

    /// <summary>True when there is JavaScript to run.</summary>
    public bool Succeeded => JavaScript is not null;

    internal static StripResult Stripped(string fileName, string javaScript) =>
        new(fileName, javaScript, []);

    internal static StripResult Refused(string fileName, IReadOnlyList<StripDiagnostic> diagnostics) =>
        new(fileName, null, diagnostics);
}
