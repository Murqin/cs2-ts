using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// What is a plugin and what is a file inside one.
///
/// These rules used to live inside the CounterStrikeSharp binding, where nothing could
/// test them: the one that was written — two files claiming one name are both refused —
/// was only ever exercised by an operator making the mistake on a server. There are more
/// of them now, and they decide what an import is allowed to reach, so they are worth
/// holding still.
/// </summary>
public sealed class PluginDiscoveryTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("cs2ts-discovery-").FullName;
    private readonly List<string> _reported = [];

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private IReadOnlyList<PluginSource> Find() => PluginDiscovery.Find(_root, _reported.Add);

    /// <summary>A folder plugin: its entry point and the manifest it needs.</summary>
    private void Plugin(string name, string? manifest = null)
    {
        File_($"{name}/index.ts");
        File_($"{name}/{PluginManifest.FileName}",
            manifest ?? $$"""{ "name": "{{name}}", "version": "1.0.0" }""");
    }

    private string File_(string relative, string contents = "")
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, contents);
        return path;
    }

    [Fact]
    public void AFileAtTheTopIsAPlugin()
    {
        File_("welcome.ts");
        File_("rounds.js");

        var found = Find();

        Assert.Equal(["rounds", "welcome"], found.Select(plugin => plugin.Name).Order());

        // No module root, which is not a restriction so much as the same rule read
        // backwards: its neighbours at the top are plugins, so there is nothing beside
        // it that is a module.
        Assert.All(found, plugin => Assert.Null(plugin.ModuleRoot));
        Assert.Empty(_reported);
    }

    [Fact]
    public void AFolderIsAPluginAndStartsAtIndex()
    {
        Plugin("jetpack");
        File_("jetpack/physics.ts");
        File_("jetpack/hud.ts");

        var plugin = Assert.Single(Find());

        Assert.Equal("jetpack", plugin.Name);
        Assert.Equal(Path.Combine(_root, "jetpack", "index.ts"), plugin.EntryPath);
        Assert.Equal(Path.Combine(_root, "jetpack"), plugin.ModuleRoot);

        // The folder is in the name because otherwise every folder plugin's stack frames
        // would read "index.ts", and five of them would be five identical file names.
        Assert.Equal("jetpack/index.ts", plugin.DisplayName);

        // The other two are modules. Nothing loads them on their own.
        Assert.Empty(_reported);
    }

    [Fact]
    public void AFolderWithNoIndexIsSaidOutLoud()
    {
        File_("jetpack/physics.ts");
        File_($"jetpack/{PluginManifest.FileName}", """{ "name": "jetpack", "version": "1.0.0" }""");

        Assert.Empty(Find());

        // Silence would be worse. Somebody put that folder there believing they had
        // installed something, and a plugin that does nothing and says nothing is the
        // hardest kind of nothing to debug.
        var message = Assert.Single(_reported);
        Assert.Contains("jetpack", message, StringComparison.Ordinal);
        Assert.Contains("index.ts", message, StringComparison.Ordinal);
    }

    /// <summary>
    /// A folder plugin has to say what it is. It is the shape of plugin somebody might
    /// install rather than write, and one that carries no name and no version can only
    /// be copied around — there is nothing to put in a bug report and nothing to
    /// compare against what is already there.
    /// </summary>
    [Fact]
    public void AFolderPluginNeedsAManifest()
    {
        File_("jetpack/index.ts");

        Assert.Empty(Find());

        var message = Assert.Single(_reported);
        Assert.Contains("plugin.json", message, StringComparison.Ordinal);

        // The message carries a correct one. Being told what is missing and not what to
        // write is most of the reason a required file is annoying.
        Assert.Contains("\"name\": \"jetpack\"", message, StringComparison.Ordinal);
        Assert.Contains("\"version\"", message, StringComparison.Ordinal);
    }

    [Fact]
    public void ASingleFileNeedsNothing()
    {
        // It has no folder to keep a manifest in, which is the same line the rest of the
        // format draws: one file is the first ten minutes, a folder is a plugin.
        File_("welcome.ts");

        var plugin = Assert.Single(Find());
        Assert.Null(plugin.Manifest);
        Assert.Equal("welcome", plugin.Describe());
        Assert.Empty(_reported);
    }

    [Fact]
    public void TheManifestIsReadAndDescribesThePlugin()
    {
        Plugin("jetpack", """
            {
                // Comments and trailing commas are allowed: this is a file people edit.
                "name": "jetpack",
                "version": "2.1.0",
                "description": "Boosts a player straight up.",
                "author": "murqin",
            }
            """);

        var plugin = Assert.Single(Find());

        Assert.Equal("2.1.0", plugin.Manifest!.Version);
        Assert.Equal("murqin", plugin.Manifest.Author);
        Assert.Equal("jetpack 2.1.0", plugin.Describe());
        Assert.Empty(_reported);
    }

    [Fact]
    public void AManifestThatDisagreesWithItsFolderIsRefused()
    {
        Plugin("jetpack", """{ "name": "surf", "version": "1.0.0" }""");

        Assert.Empty(Find());

        // The folder is where a plugin is installed, so an archive that disagrees with
        // the folder it was unpacked into is one somebody renamed.
        var message = Assert.Single(_reported);
        Assert.Contains("'surf'", message, StringComparison.Ordinal);
        Assert.Contains("'jetpack'", message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{ "name": "jetpack" }""")]
    [InlineData("""{ "version": "1.0.0" }""")]
    [InlineData("{}")]
    public void BothRequiredFieldsAreRequired(string manifest)
    {
        Plugin("jetpack", manifest);

        Assert.Empty(Find());
        Assert.Contains("name and a version", Assert.Single(_reported), StringComparison.Ordinal);
    }

    [Fact]
    public void AManifestThatIsNotJsonSaysWhereItStopped()
    {
        Plugin("jetpack", """{ "name": "jetpack", "version" }""");

        Assert.Empty(Find());

        // The parser's own message, kept rather than replaced, because it carries the
        // line and position and nothing written here would.
        var message = Assert.Single(_reported);
        Assert.Contains("not valid JSON", message, StringComparison.Ordinal);
        Assert.Contains("LineNumber", message, StringComparison.Ordinal);
    }

    /// <summary>
    /// The one field that does something today. Without it a plugin written against a
    /// newer CS2-TS loads and then fails at whichever global it reaches for first, which
    /// says nothing about the real problem.
    /// </summary>
    [Fact]
    public void APluginMayAskForASurfaceThisServerDoesNotHave()
    {
        Plugin("jetpack", """{ "name": "jetpack", "version": "1.0.0", "api": "0.9" }""");

        Assert.Empty(PluginDiscovery.Find(_root, "0.1", _reported.Add));

        var message = Assert.Single(_reported);
        Assert.Contains("written for CS2-TS 0.9", message, StringComparison.Ordinal);
        Assert.Contains("provides 0.1", message, StringComparison.Ordinal);
    }

    [Fact]
    public void AskingForLessThanThereIsIsFine()
    {
        Plugin("jetpack", """{ "name": "jetpack", "version": "1.0.0", "api": "0.1" }""");

        // Nothing leaves the surface without the major number moving, so a plugin
        // written against 0.1 used what 0.1 had and that is all still here.
        Assert.Single(PluginDiscovery.Find(_root, "0.4", _reported.Add));
        Assert.Empty(_reported);
    }

    [Fact]
    public void ASurfaceThatHasMovedOnIsADifferentSentence()
    {
        Plugin("jetpack", """{ "name": "jetpack", "version": "1.0.0", "api": "0.9" }""");

        Assert.Empty(PluginDiscovery.Find(_root, "1.0", _reported.Add));

        // "not yet" and "no longer" are different problems with different fixes.
        Assert.Contains("newer version of the plugin", Assert.Single(_reported), StringComparison.Ordinal);
    }

    [Fact]
    public void APluginThatAsksForNothingRuns()
    {
        Plugin("jetpack");

        // Most authors will not think about this and most of them will be right.
        Assert.Single(PluginDiscovery.Find(_root, "0.1", _reported.Add));
        Assert.Empty(_reported);
    }

    /// <summary>
    /// A key this version knows nothing about is ignored, and the api field is what
    /// makes that safe: anything that adds a key which matters raises the surface
    /// version with it, and then the plugin is refused outright rather than loaded with
    /// half of what it asked for quietly dropped.
    /// </summary>
    [Fact]
    public void AKeyFromALaterVersionIsIgnored()
    {
        Plugin("jetpack", """
            { "name": "jetpack", "version": "1.0.0", "permissions": ["network"] }
            """);

        Assert.Single(Find());
        Assert.Empty(_reported);
    }

    [Fact]
    public void ToolFoldersAreIgnoredWithoutComment()
    {
        File_(".vscode/settings.json");
        File_("node_modules/left-pad/index.ts");
        File_("node_modules/left-pad/plugin.json");
        File_("welcome.ts");

        Assert.Equal("welcome", Assert.Single(Find()).Name);

        // These are not failed plugins, and complaining about them on every single load
        // is how a log stops being read.
        Assert.Empty(_reported);
    }

    [Fact]
    public void TwoThingsCannotClaimOneName()
    {
        File_("vip.ts");
        File_("vip.js");
        Plugin("survivor");

        Assert.Equal("survivor", Assert.Single(Find()).Name);

        // Both refused rather than one picked. Which one won would depend on the order
        // this list happens to be built in, and that is not something an operator can
        // see or fix.
        var message = Assert.Single(_reported);
        Assert.Contains("'vip'", message, StringComparison.Ordinal);
    }

    [Fact]
    public void AFileAndAFolderCannotClaimOneNameEither()
    {
        File_("jetpack.ts");
        Plugin("jetpack");

        Assert.Empty(Find());

        var message = Assert.Single(_reported);
        Assert.Contains("jetpack.ts", message, StringComparison.Ordinal);
        Assert.Contains("jetpack/", message, StringComparison.Ordinal);
    }

    [Fact]
    public void AFolderCannotHaveTwoEntryPoints()
    {
        Plugin("jetpack");
        File_("jetpack/index.js");

        Assert.Empty(Find());
        Assert.Contains("index.ts and index.js", Assert.Single(_reported), StringComparison.Ordinal);
    }

    [Fact]
    public void DeclarationFilesAreNotPlugins()
    {
        File_("cs2ts.d.ts");
        File_("tsconfig.json");

        Assert.Empty(Find());
        Assert.Empty(_reported);
    }

    [Fact]
    public void APathIsOwnedByThePluginItIsInside()
    {
        File_("welcome.ts");
        Plugin("jetpack");
        File_("jetpack/deep/physics.ts");
        var found = Find();

        // The question the watcher asks. A save two folders down is a change to the
        // plugin, which is the whole reason the folder is the unit.
        Assert.Equal("jetpack", PluginDiscovery.Owning(found, Path.Combine(_root, "jetpack", "deep", "physics.ts"))?.Name);
        Assert.Equal("jetpack", PluginDiscovery.Owning(found, Path.Combine(_root, "jetpack", "index.ts"))?.Name);
        Assert.Equal("welcome", PluginDiscovery.Owning(found, Path.Combine(_root, "welcome.ts"))?.Name);

        // A file that was never part of anything. Answering "nothing" is what keeps an
        // editor's scratch file from reloading a plugin.
        Assert.Null(PluginDiscovery.Owning(found, Path.Combine(_root, "notes.txt")));
        Assert.Null(PluginDiscovery.Owning(found, Path.Combine(_root, "cs2ts.d.ts")));
    }

    [Fact]
    public void OwnershipSurvivesTheFileBeingDeleted()
    {
        Plugin("jetpack");
        var found = Find();

        Directory.Delete(Path.Combine(_root, "jetpack"), recursive: true);

        // Asked of what discovery last saw rather than of the disk, because that is the
        // only way a deleted file can still name the plugin that has to be unloaded.
        Assert.Equal("jetpack", PluginDiscovery.Owning(found, Path.Combine(_root, "jetpack", "index.ts"))?.Name);
    }

    [Fact]
    public void ContainsResolvesBeforeItCompares()
    {
        var jetpack = Path.Combine(_root, "jetpack");

        Assert.True(PluginDiscovery.Contains(jetpack, Path.Combine(jetpack, "physics.ts")));
        Assert.True(PluginDiscovery.Contains(jetpack, Path.Combine(jetpack, "deep", "physics.ts")));

        // The check that matters: a path into another plugin wearing this one's prefix.
        // Comparing the text alone would let it through, and the folder boundary is the
        // whole of the import sandbox.
        Assert.False(PluginDiscovery.Contains(jetpack, Path.Combine(jetpack, "..", "surf", "internals.ts")));
        Assert.False(PluginDiscovery.Contains(jetpack, Path.Combine(_root, "surf", "internals.ts")));

        // A folder is not inside itself, and a sibling whose name starts the same way is
        // not inside it either.
        Assert.False(PluginDiscovery.Contains(jetpack, jetpack));
        Assert.False(PluginDiscovery.Contains(jetpack, jetpack + "-old/x.ts"));
    }
}
