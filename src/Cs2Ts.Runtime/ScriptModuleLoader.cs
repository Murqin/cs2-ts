using Microsoft.ClearScript;
using Microsoft.ClearScript.JavaScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// Turns an <c>import</c> into a module V8 can run: finds the file, strips its types,
/// and refuses everything outside the plugin it belongs to.
///
/// One of these per load. It holds the diagnostics rather than throwing them, because
/// a throw does not survive the trip: an exception raised in here comes back out of
/// <c>Execute</c> as a <see cref="ScriptEngineException"/> with the original type gone,
/// so anything the author needs to see — the file, the line, the code — has to be
/// picked up from here afterwards rather than caught.
/// </summary>
/// <param name="pluginName">The plugin being loaded, for the messages.</param>
/// <param name="moduleRoot">
/// The folder an import may reach inside, or null for a plugin that is a single file.
/// Null means no imports at all: every file at the top of the scripts folder is its own
/// plugin, so a single file has no neighbour that is a module.
/// </param>
/// <param name="stripper">
/// The type stripper. Called from inside V8's module resolution, on a second engine
/// sharing the same runtime — which was measured to work rather than assumed, because
/// it is re-entering the isolate from within a callback out of it.
/// </param>
public sealed class ScriptModuleLoader(string pluginName, string? moduleRoot, TypeStripper stripper)
    : DocumentLoader
{
    private readonly List<StripDiagnostic> _diagnostics = [];

    // One document per file, for the life of this load. The base class offers a cache
    // and then refuses to keep anything in it — GetCachedDocument answers null and
    // CacheDocument throws "does not support caching"; only ClearScript's own default
    // loader implements them. So the cache is here.
    private readonly Dictionary<string, Document> _loaded = new(StringComparer.Ordinal);

    /// <summary>
    /// Why a module was refused, in the author's own source. Empty when nothing was.
    ///
    /// Read after the load rather than caught during it. It is the only way the file
    /// and line of a mistake inside an imported module reach the author.
    /// </summary>
    public IReadOnlyList<StripDiagnostic> Diagnostics => _diagnostics;

    /// <inheritdoc />
    public override Task<Document> LoadDocumentAsync(
        DocumentSettings settings,
        DocumentInfo? sourceInfo,
        string specifier,
        DocumentCategory category,
        DocumentContextCallback contextCallback)
    {
        ArgumentException.ThrowIfNullOrEmpty(specifier);

        if (moduleRoot is null)
        {
            throw new InvalidOperationException(
                $"'{pluginName}' is a single file, so it cannot import '{specifier}'. " +
                "Every file at the top of the scripts folder is its own plugin; to split this one up, " +
                $"make a folder called '{pluginName}' with an index.ts in it and put the rest beside it.");
        }

        // A bare specifier is a package name, and there are no packages. Saying so is
        // worth a sentence: the alternative is "module not found" for a line the
        // author's editor was perfectly happy with, since the compiler resolves types
        // from node_modules whether or not anything can run them.
        if (!specifier.StartsWith('.') && !Path.IsPathRooted(specifier))
        {
            throw new InvalidOperationException(
                $"'{pluginName}' imports '{specifier}', which is a package rather than a file in the plugin. " +
                "Packages are not supported yet; imports have to start with './' or '../'.");
        }

        // Relative to the file doing the importing, which is what every module system
        // means by a relative specifier — not relative to the plugin's entry point, and
        // not to the server's working directory.
        var from = sourceInfo?.Uri is { IsFile: true } importer
            ? Path.GetDirectoryName(importer.LocalPath)!
            : moduleRoot;

        var path = Resolve(from, specifier)
            ?? throw new FileNotFoundException(
                $"'{pluginName}' imports '{specifier}', and there is no such file in the plugin.");

        // The boundary, and the whole of it. A plugin is a folder: what it can reach is
        // what is inside it, so it can be handed to somebody else as an archive and
        // still work, and so that deleting one plugin cannot break another. The check
        // resolves both sides first — '../surf/x.ts' is a path into another plugin
        // however it is spelled.
        if (!PluginDiscovery.Contains(moduleRoot, path))
        {
            throw new UnauthorizedAccessException(
                $"'{pluginName}' imports '{specifier}', which is outside its own folder. " +
                "A plugin can only import files inside itself.");
        }

        // One module per file, however many files import it. Handing back a fresh
        // Document for the second importer makes V8 evaluate the module a second time —
        // measured — which means its top level runs twice, its state exists twice, and
        // `===` between two objects it exported is false. A plugin's modules are the one
        // thing an author expects to be singletons.
        //
        // The cache is this loader's, and there is one loader per load, so a reload
        // reads from disk again rather than serving what the previous version had.
        if (_loaded.TryGetValue(path, out var cached))
        {
            return Task.FromResult(cached);
        }

        var name = Path.GetRelativePath(moduleRoot, path);
        var stripped = stripper.Strip(name, File.ReadAllText(path));

        if (!stripped.Succeeded)
        {
            _diagnostics.AddRange(stripped.Diagnostics);
            throw new InvalidOperationException($"'{name}' could not be compiled; see the errors above.");
        }

        // The URI is what every stack frame from this module will carry, and it is the
        // real path so that two plugins with an index.ts each stay tellable apart.
        var document = new StringDocument(
            new DocumentInfo(new Uri(path)) { Category = ModuleCategory.Standard },
            stripped.JavaScript!);

        _loaded[path] = document;
        return Task.FromResult<Document>(document);
    }

    /// <summary>
    /// The file a specifier means, or null when there is none.
    ///
    /// The candidates are the ones the shipped tsconfig accepts, and that is the point
    /// rather than generosity: the compiler runs under <c>moduleResolution: bundler</c>
    /// with <c>allowImportingTsExtensions</c>, so it resolves an extensionless name, a
    /// <c>.ts</c> name, and a folder with an index in it. Anything it accepts and this
    /// refuses would be a script that type-checks and does not load — which is the
    /// inconsistency this whole step exists to close, reappearing one layer down.
    /// </summary>
    private static string? Resolve(string from, string specifier)
    {
        var target = Path.GetFullPath(Path.Combine(from, specifier));

        IEnumerable<string> Candidates()
        {
            yield return target;

            foreach (var extension in ScriptFile.Extensions)
            {
                yield return target + extension;
                yield return Path.Combine(target, "index" + extension);
            }

            // './physics.js' meaning physics.ts is TypeScript's own rule, not ours, and
            // an author who learned it elsewhere writes it here.
            if (target.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
            {
                yield return string.Concat(target.AsSpan(0, target.Length - 3), ".ts");
            }
        }

        // A declaration file is types and nothing else: running one fails on its first
        // export, against a file the author did not write.
        return Candidates().FirstOrDefault(path => !ScriptFile.IsDeclaration(path) && File.Exists(path));
    }
}
