using System.Text.RegularExpressions;

namespace Cs2Ts.Server.Tests;

/// <summary>
/// Strips the colour codes the engine writes around its own log lines.
///
/// Worth its own file only because of how it fails otherwise: a line that reads
/// correctly in a terminal carries invisible escape sequences, and an assertion on it
/// fails while the expected and actual strings look identical in the test output.
/// </summary>
internal static partial class Ansi
{
    public static string Strip(string line) => Escape().Replace(line, "");

    [GeneratedRegex(@"\x1b\[[0-9;]*[A-Za-z]")]
    private static partial Regex Escape();
}
