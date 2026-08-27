using System.Reflection;

namespace Cs2Ts.Plugin;

/// <summary>
/// Puts the type declarations and the compiler settings where the author's editor will
/// find them: in the directory they drop scripts into.
///
/// Without this the project's central promise quietly does not hold. The declarations
/// and the tsconfig exist, but they sit in the repository, and an operator who has only
/// ever installed the plugin has no reason to know that. Open the scripts directory in
/// an editor and nothing is known: <c>on</c> and <c>players</c> are undefined names,
/// <c>player.health</c> has no type, <c>fetch</c> looks available, and <c>enum</c>
/// compiles. Every one of those is meant to be refused before the file reaches a server,
/// and none of them is refused until two files are copied by hand.
///
/// So they are not copied by hand.
/// </summary>
internal static class AuthorSetup
{
    /// <summary>
    /// Writes what the author needs into <paramref name="scriptDirectory"/>.
    ///
    /// The two files are treated differently on purpose. The declarations describe this
    /// plugin's own surface, so they are ours to keep current — a stale copy would
    /// under-declare a newly added API and report the author's correct code as wrong.
    /// The compiler settings are the author's project, so they are written once and
    /// never touched again; someone who loosens a rule meant it.
    /// </summary>
    public static void Install(string scriptDirectory, Action<string> log)
    {
        Write(scriptDirectory, "cs2ts.d.ts", overwrite: true, log);
        Write(scriptDirectory, "tsconfig.json", overwrite: false, log);
    }

    private static void Write(string directory, string name, bool overwrite, Action<string> log)
    {
        var path = Path.Combine(directory, name);

        string contents;
        try
        {
            contents = Read(name);
        }
        catch (Exception exception)
        {
            // A missing resource is a packaging mistake, not the operator's problem, and
            // it must not stop scripts from loading.
            log($"could not read the bundled {name}: {exception.Message}");
            return;
        }

        try
        {
            if (File.Exists(path))
            {
                if (!overwrite || File.ReadAllText(path) == contents)
                {
                    return;
                }

                File.WriteAllText(path, contents);
                log($"updated {name} in scripts/ — it declares this plugin's API and is kept current");
                return;
            }

            File.WriteAllText(path, contents);
            log($"wrote {name} into scripts/ — open that folder in your editor and the API is typed");
        }
        catch (IOException exception)
        {
            log($"could not write {name}: {exception.Message}");
        }
        catch (UnauthorizedAccessException exception)
        {
            log($"could not write {name}: {exception.Message}");
        }
    }

    private static string Read(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"{name} is not embedded in the plugin");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
