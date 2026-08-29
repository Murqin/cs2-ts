using System.Text.Json;
using System.Text.Json.Serialization;

namespace Cs2Ts.Runtime;

/// <summary>
/// What a plugin says about itself: <c>plugin.json</c>, beside its <c>index.ts</c>.
///
/// Required of every folder plugin, and only of those — a single file has no folder to
/// put one in, and that is the same line the rest of the format draws. A single file is
/// the first ten minutes; a folder is a plugin somebody might install, and one that does
/// not say what it is or what version it is cannot be installed, only copied.
///
/// Two fields are required and the rest are not, which is the same bargain npm makes
/// with <c>package.json</c>. Asking for more would be asking authors to fill in a form
/// for fields nothing reads.
/// </summary>
/// <param name="Name">
/// The plugin's name, which has to be the folder's name too.
///
/// Stating it twice sounds redundant and is checked rather than assumed: the folder is
/// where the plugin is installed, so an archive that disagrees with the folder it was
/// unpacked into is an archive somebody renamed, and saying so beats loading it under a
/// name it does not think is its own.
/// </param>
/// <param name="Version">
/// The plugin author's own version. Nothing here parses it — it is theirs, and a scheme
/// imposed on it would be a scheme to argue with. It exists so that a bug report can say
/// which one.
/// </param>
/// <param name="Description">One line about what the plugin does. Optional.</param>
/// <param name="Author">Who to ask about it. Optional.</param>
/// <param name="Api">
/// The CS2-TS surface the plugin was written against, as <c>major.minor</c>. Optional,
/// and the one field here that does something today: a plugin asking for a newer surface
/// than this server has is refused with a sentence, rather than loaded and left to fail
/// at the first global it expects and does not find.
///
/// It is also what makes ignoring unknown fields safe. A plugin written for a later
/// CS2-TS may carry keys this version knows nothing about — and silently dropping one
/// that mattered would be the worst kind of quiet. Anything that adds a key that matters
/// raises the surface version with it, and then this refuses the plugin outright.
/// </param>
public sealed record PluginManifest(
    string Name,
    string Version,
    string? Description = null,
    string? Author = null,
    string? Api = null)
{
    /// <summary>The file a folder plugin is described by.</summary>
    public const string FileName = "plugin.json";

    /// <summary>
    /// Comments and trailing commas are allowed because this is a file people edit by
    /// hand, and refusing a plugin over a trailing comma would be a bad first day. The
    /// naming policy matches what an author would write without being told.
    /// </summary>
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,

        // Unknown keys are ignored rather than refused, and Api above is why that is
        // safe. Refusing them would mean a plugin could never carry anything a later
        // CS2-TS understands without breaking on an earlier one.
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
    };

    /// <summary>
    /// Reads the manifest for a folder, or explains what is wrong with it.
    ///
    /// Every failure here stops the plugin loading, so every message has to be one an
    /// operator can act on without reading this file: what was expected, where, and what
    /// a correct one looks like.
    /// </summary>
    /// <param name="folder">The plugin folder.</param>
    /// <param name="name">The folder's name, which the manifest has to agree with.</param>
    /// <param name="error">Why it could not be read. Null when it could.</param>
    public static PluginManifest? Read(string folder, string name, out string? error)
    {
        ArgumentException.ThrowIfNullOrEmpty(folder);
        ArgumentException.ThrowIfNullOrEmpty(name);

        var path = Path.Combine(folder, FileName);

        if (!File.Exists(path))
        {
            error = $"'{name}' has no {FileName}, so it was not loaded. Every plugin folder needs one:\n" +
                    Example(name);
            return null;
        }

        PluginManifest? manifest;
        try
        {
            manifest = JsonSerializer.Deserialize<PluginManifest>(File.ReadAllText(path), Options);
        }
        catch (JsonException exception)
        {
            // The message carries a line and a position, which is the whole reason to
            // let it through rather than replace it with something of our own.
            error = $"'{name}/{FileName}' is not valid JSON: {exception.Message}";
            return null;
        }
        catch (IOException exception)
        {
            error = $"'{name}/{FileName}' could not be read: {exception.Message}";
            return null;
        }

        if (manifest is null)
        {
            error = $"'{name}/{FileName}' is empty. It needs at least a name and a version:\n{Example(name)}";
            return null;
        }

        if (string.IsNullOrWhiteSpace(manifest.Name) || string.IsNullOrWhiteSpace(manifest.Version))
        {
            error = $"'{name}/{FileName}' needs both a name and a version:\n{Example(name)}";
            return null;
        }

        if (!string.Equals(manifest.Name, name, StringComparison.Ordinal))
        {
            error = $"'{name}/{FileName}' calls itself '{manifest.Name}', but it is in a folder called " +
                    $"'{name}'. Rename one of them so the plugin has a single name.";
            return null;
        }

        if (manifest.Api is { } api && !IsSurfaceVersion(api))
        {
            error = $"'{name}/{FileName}' has an api of '{api}', which is not a major.minor version " +
                    "like \"0.1\".";
            return null;
        }

        error = null;
        return manifest;
    }

    /// <summary>
    /// Whether this plugin can run against a given surface version.
    ///
    /// A plugin that asks for nothing runs, because most plugins will not think about
    /// this and most of them will be right. One that asks for more than there is does
    /// not, because the alternative is an author's plugin failing at whichever global it
    /// reaches for first, which says nothing about the real problem.
    ///
    /// Asking for less is fine. Nothing is taken away from the surface without the major
    /// number moving, and a plugin written against 0.1 is a plugin that used what 0.1
    /// had.
    /// </summary>
    /// <param name="surface">What this server provides, as major.minor.</param>
    /// <param name="error">Why not. Null when it can.</param>
    public bool RunsAgainst(string surface, out string? error)
    {
        ArgumentException.ThrowIfNullOrEmpty(surface);

        if (Api is null)
        {
            error = null;
            return true;
        }

        var (wantedMajor, wantedMinor) = Parse(Api);
        var (haveMajor, haveMinor) = Parse(surface);

        if (wantedMajor > haveMajor || (wantedMajor == haveMajor && wantedMinor > haveMinor))
        {
            error = $"'{Name}' was written for CS2-TS {Api} and this server provides {surface}. " +
                    "Update the plugin that hosts it, or install an older version of this one.";
            return false;
        }

        // A major that has moved on means things this plugin used are gone, which is a
        // different sentence from "not yet".
        if (wantedMajor < haveMajor)
        {
            error = $"'{Name}' was written for CS2-TS {Api} and this server provides {surface}, " +
                    "which is not compatible with it. Install a newer version of the plugin.";
            return false;
        }

        error = null;
        return true;
    }

    private static bool IsSurfaceVersion(string value)
    {
        var parts = value.Split('.');
        return parts.Length == 2 && parts.All(part => int.TryParse(part, out var number) && number >= 0);
    }

    private static (int Major, int Minor) Parse(string value)
    {
        var parts = value.Split('.');
        return (int.Parse(parts[0]), int.Parse(parts[1]));
    }

    private static string Example(string name) =>
        $$"""
            {
                "name": "{{name}}",
                "version": "1.0.0"
            }
        """;

    /// <summary>"jetpack 1.0.0". What a status listing shows.</summary>
    public override string ToString() => $"{Name} {Version}";
}
