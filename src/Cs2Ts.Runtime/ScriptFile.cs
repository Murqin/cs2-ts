namespace Cs2Ts.Runtime;

/// <summary>
/// What counts as a script on disk.
///
/// A rule rather than a glob, because the glob got it wrong: <c>*.ts</c> matches
/// <c>cs2ts.d.ts</c>, and a declaration file emits nothing, so running one fails on its
/// first export against a file the author never wrote. That stayed invisible while
/// declarations lived in the repository and appeared the moment the plugin started
/// putting them where the author works.
/// </summary>
public static class ScriptFile
{
    /// <summary>The extensions a script may have. Both are first class.</summary>
    public static readonly string[] Extensions = [".ts", ".js"];

    /// <summary>
    /// A TypeScript declaration file: types only, no runtime code. Never a script,
    /// however much its extension looks like one.
    /// </summary>
    public static bool IsDeclaration(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        return path.EndsWith(".d.ts", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Whether this file should be loaded and run.</summary>
    public static bool IsScript(string path)
    {
        ArgumentNullException.ThrowIfNull(path);

        return !IsDeclaration(path) &&
               Extensions.Any(extension => path.EndsWith(extension, StringComparison.OrdinalIgnoreCase));
    }
}
