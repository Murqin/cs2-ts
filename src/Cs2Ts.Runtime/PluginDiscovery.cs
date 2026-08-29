namespace Cs2Ts.Runtime;

/// <summary>
/// What is a plugin, and what is merely a file inside one.
///
/// A plugin is one of two things and nothing else:
///
/// <code>
/// scripts/welcome.ts        →  the plugin "welcome"
/// scripts/jetpack/          →  the plugin "jetpack", starting at jetpack/index.ts
/// </code>
///
/// Everything below a plugin folder is a module: it is imported by name and never
/// loaded on its own. That one rule is what makes the rest of the design small. The
/// folder is the unit, so a change anywhere inside it reloads that plugin and nothing
/// has to keep a graph of who imports whom. The folder is the boundary, so an import
/// is allowed or refused by asking one question about a path. And the folder is the
/// whole plugin, so distributing one is putting it in an archive.
///
/// The single file stays because it is the whole of the first ten minutes: drop a file
/// in, it runs. What it cannot do is import, and that is not a limitation so much as
/// the same rule read backwards — its neighbours at the top of the folder are plugins,
/// not modules, so there is nothing there to import.
/// </summary>
public static class PluginDiscovery
{
    /// <summary>What a plugin folder's entry point may be called.</summary>
    private static readonly string[] EntryNames = ["index.ts", "index.js"];

    /// <summary>
    /// Folders that are never a plugin however they look. <c>node_modules</c> is here
    /// because an author who reaches for a package manager should get a bad day from
    /// the package manager rather than several hundred failed plugin loads.
    /// </summary>
    private static readonly string[] IgnoredFolders = ["node_modules"];

    /// <summary>
    /// Every plugin in a directory, in a stable order.
    /// </summary>
    /// <param name="directory">The scripts folder.</param>
    /// <param name="report">
    /// Told about anything that looks like a plugin and is not loadable. It is spoken
    /// out loud rather than skipped quietly: a folder somebody believes they installed
    /// and that does nothing is worse than an error message.
    /// </param>
    public static IReadOnlyList<PluginSource> Find(string directory, Action<string> report)
    {
        ArgumentException.ThrowIfNullOrEmpty(directory);
        ArgumentNullException.ThrowIfNull(report);

        if (!Directory.Exists(directory))
        {
            return [];
        }

        var found = new List<PluginSource>();
        found.AddRange(SingleFiles(directory));
        found.AddRange(Folders(directory, report));

        return Unambiguous(found, report);
    }

    /// <summary>
    /// The plugin a path belongs to, or null when it belongs to none.
    ///
    /// The question the file watcher asks: a save inside <c>jetpack/physics.ts</c> has
    /// to reload <c>jetpack</c>, not nothing. Answering it by name rather than by
    /// reading the disk again means a deleted file still names the plugin it was part of.
    /// </summary>
    public static PluginSource? Owning(IEnumerable<PluginSource> plugins, string path)
    {
        ArgumentNullException.ThrowIfNull(plugins);
        ArgumentException.ThrowIfNullOrEmpty(path);

        var full = Path.GetFullPath(path);

        foreach (var plugin in plugins)
        {
            if (plugin.ModuleRoot is { } root)
            {
                if (Contains(root, full))
                {
                    return plugin;
                }
            }
            else if (string.Equals(Path.GetFullPath(plugin.EntryPath), full, StringComparison.Ordinal))
            {
                return plugin;
            }
        }

        return null;
    }

    /// <summary>
    /// Whether a path is inside a folder. The check every import is refused or allowed
    /// by, so it is written once here rather than at each call site.
    ///
    /// Both sides are resolved first, which is the whole point: <c>jetpack/../surf/x.ts</c>
    /// is a path inside <c>surf</c> wearing a <c>jetpack</c> prefix, and comparing the
    /// text alone would let it through.
    /// </summary>
    public static bool Contains(string folder, string path)
    {
        ArgumentException.ThrowIfNullOrEmpty(folder);
        ArgumentException.ThrowIfNullOrEmpty(path);

        var root = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar);
        var full = Path.GetFullPath(path);

        return full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal);
    }

    private static IEnumerable<PluginSource> SingleFiles(string directory) =>
        Directory.EnumerateFiles(directory, "*", SearchOption.TopDirectoryOnly)
            .Where(ScriptFile.IsScript)
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => new PluginSource(
                Path.GetFileNameWithoutExtension(path), path, ModuleRoot: null));

    private static IEnumerable<PluginSource> Folders(string directory, Action<string> report)
    {
        foreach (var folder in Directory.EnumerateDirectories(directory).OrderBy(p => p, StringComparer.Ordinal))
        {
            var name = Path.GetFileName(folder);

            // A dot folder is a tool's, not an author's — .git, .vscode, .claude. Saying
            // anything about them would be noise on every single load.
            if (name.StartsWith('.') || IgnoredFolders.Contains(name, StringComparer.Ordinal))
            {
                continue;
            }

            var entry = EntryNames
                .Select(candidate => Path.Combine(folder, candidate))
                .FirstOrDefault(File.Exists);

            if (entry is null)
            {
                report($"'{name}' has no index.ts, so nothing in it was loaded. " +
                       "A plugin folder starts at index.ts; the other files in it are modules it imports.");
                continue;
            }

            // Both, which is the same ambiguity a plugin named twice has and is refused
            // for the same reason: which one wins would depend on the order of this
            // array, and nobody installing a plugin can reason about that.
            var alternatives = EntryNames
                .Select(candidate => Path.Combine(folder, candidate))
                .Where(File.Exists)
                .ToArray();

            if (alternatives.Length > 1)
            {
                report($"'{name}' has both index.ts and index.js; keep one. It was not loaded.");
                continue;
            }

            yield return new PluginSource(name, entry, folder);
        }
    }

    /// <summary>
    /// Drops every plugin whose name is claimed more than once.
    ///
    /// All of them rather than all but one. Picking a winner means the winner is decided
    /// by the order this list happens to be built in, which is not something an operator
    /// can see, reason about or fix — whereas two plugins refused by name is a sentence
    /// that says exactly what to rename.
    /// </summary>
    private static List<PluginSource> Unambiguous(List<PluginSource> found, Action<string> report)
    {
        var kept = new List<PluginSource>();

        foreach (var group in found.GroupBy(plugin => plugin.Name, StringComparer.Ordinal)
                     .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            if (group.Count() == 1)
            {
                kept.Add(group.Single());
                continue;
            }

            var claimants = group.Select(plugin => plugin.ModuleRoot is null
                ? Path.GetFileName(plugin.EntryPath)
                : Path.GetFileName(plugin.ModuleRoot) + "/");

            report($"'{group.Key}' is claimed by more than one thing " +
                   $"({string.Join(", ", claimants)}); rename one. None of them was loaded.");
        }

        return kept;
    }
}
