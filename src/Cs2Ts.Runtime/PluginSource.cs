namespace Cs2Ts.Runtime;

/// <summary>
/// One plugin as it sits on disk: what it is called, which file starts it, and where
/// its modules may come from.
/// </summary>
/// <param name="Name">
/// What the plugin is called — the file name without its extension, or the folder name.
/// It is the name an operator types at <c>cs2ts_reload</c> and the one every message
/// about this plugin carries.
/// </param>
/// <param name="EntryPath">The file that is loaded and run.</param>
/// <param name="ModuleRoot">
/// The folder an import may reach inside, or null for a plugin that is a single file.
///
/// Null is not "no restriction", it is "no imports at all", and that falls straight out
/// of what a plugin is. Every file at the top of the scripts folder is its own plugin,
/// so a single file has no sibling that is a module rather than a plugin — there is
/// nothing it could import. Moving it into a folder is what gives it one.
/// </param>
/// <param name="Manifest">
/// What the plugin says about itself, or null for a single file — which has no folder to
/// keep one in, and is the one shape of plugin that does not need to introduce itself.
/// </param>
public sealed record PluginSource(
    string Name,
    string EntryPath,
    string? ModuleRoot,
    PluginManifest? Manifest = null)
{
    /// <summary>
    /// How the entry file is named in errors and stack frames: "welcome.ts" for a
    /// single file, "jetpack/index.ts" for a folder.
    ///
    /// The folder is part of it because without it every folder plugin's frames would
    /// read "index.ts", and a server running five of them would produce five identical
    /// file names for five different mistakes.
    /// </summary>
    public string DisplayName => ModuleRoot is null
        ? Path.GetFileName(EntryPath)
        : $"{Path.GetFileName(ModuleRoot)}/{Path.GetFileName(EntryPath)}";

    /// <summary>"jetpack 1.0.0", or just "welcome" for a plugin with no manifest.</summary>
    public string Describe() => Manifest?.ToString() ?? Name;
}
