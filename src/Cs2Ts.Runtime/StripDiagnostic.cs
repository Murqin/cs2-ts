namespace Cs2Ts.Runtime;

/// <summary>
/// One reason a plugin file was refused, located in the author's own source.
/// </summary>
/// <param name="FileName">The plugin file as the author named it.</param>
/// <param name="Code">
/// A TypeScript diagnostic code (<c>TS1005</c>) when the file did not parse, or a
/// <c>CS2TS_</c> code when it parsed but uses syntax the stripper cannot erase.
/// </param>
/// <param name="Message">What is wrong and what to write instead.</param>
/// <param name="Line">1-based line in the original TypeScript.</param>
/// <param name="Column">1-based column in the original TypeScript.</param>
public sealed record StripDiagnostic(string FileName, string Code, string Message, int Line, int Column)
{
    /// <summary>
    /// Formatted the way tsc formats diagnostics, so that editors and terminals that
    /// already know how to turn a compiler line into a jump target keep working.
    /// </summary>
    public override string ToString() => $"{FileName}({Line},{Column}): error {Code}: {Message}";
}
