namespace Cs2Ts.Runtime;

/// <summary>
/// What happened to a load or reload. A plugin either loaded or it did not, and the
/// reason is always something the author can act on: a diagnostic pointing into their
/// TypeScript, or an error from their own top-level code.
/// </summary>
public sealed class PluginLoadResult
{
    private PluginLoadResult(
        string name,
        ScriptPlugin? plugin,
        IReadOnlyList<StripDiagnostic> diagnostics,
        ScriptError? error)
    {
        Name = name;
        Plugin = plugin;
        Diagnostics = diagnostics;
        Error = error;
    }

    /// <summary>The plugin's name, whether or not it loaded.</summary>
    public string Name { get; }

    /// <summary>The loaded plugin, or <c>null</c>.</summary>
    public ScriptPlugin? Plugin { get; }

    /// <summary>Why the TypeScript was refused. Empty unless that is what failed.</summary>
    public IReadOnlyList<StripDiagnostic> Diagnostics { get; }

    /// <summary>What the plugin's own top-level code threw, if that is what failed.</summary>
    public ScriptError? Error { get; }

    /// <summary>True when there is a running plugin.</summary>
    public bool Succeeded => Plugin is not null;

    /// <summary>One line per reason, ready for a log.</summary>
    public IEnumerable<string> Report()
    {
        foreach (var diagnostic in Diagnostics)
        {
            yield return diagnostic.ToString();
        }

        if (Error is not null)
        {
            yield return Error.ToString();
        }
    }

    internal static PluginLoadResult Loaded(ScriptPlugin plugin) =>
        new(plugin.Name, plugin, [], null);

    internal static PluginLoadResult Refused(string name, IReadOnlyList<StripDiagnostic> diagnostics) =>
        new(name, null, diagnostics, null);

    internal static PluginLoadResult Failed(string name, ScriptError error) =>
        new(name, null, [], error);
}
