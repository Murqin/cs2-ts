using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime;

/// <summary>
/// Settings a host is built with. Defaults are chosen for a live server rather than
/// for a benchmark.
/// </summary>
/// <param name="Budget">
/// How long one crossing into script may take before the watchdog interrupts it.
/// Generous on purpose: it exists to bound a hang, not to police slow code.
/// </param>
/// <param name="Policy">When a repeatedly failing handler is taken out of service.</param>
public sealed record ScriptHostOptions(TimeSpan Budget = default, BoundaryPolicy? Policy = null)
{
    /// <summary>Half a second is dozens of ticks: nothing working takes that long.</summary>
    public TimeSpan Budget { get; } = Budget == default ? TimeSpan.FromMilliseconds(500) : Budget;
}

/// <summary>
/// Owns everything shared between plugins: the V8 runtime, the type stripper, the
/// watchdog, and the queue that brings background work back to the game thread.
///
/// One runtime, one engine per plugin. Engines built from a shared runtime live in one
/// isolate, so the TypeScript parser is resident once however many plugins are loaded,
/// while each plugin still gets a context of its own to be thrown away on reload.
/// </summary>
public sealed class ScriptHost : IDisposable
{
    private readonly V8Runtime _runtime;
    private readonly ScriptWatchdog _watchdog;
    private readonly Action<ScriptError> _report;
    private readonly ScriptHostOptions _options;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, ScriptPlugin> _plugins = [];
    private readonly HashSet<string> _knownCommands = new(StringComparer.Ordinal);
    private bool _disposed;

    /// <param name="report">Where every script error goes. Must not throw.</param>
    /// <param name="options">Watchdog budget and flood policy.</param>
    public ScriptHost(Action<ScriptError> report, ScriptHostOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(report);

        _report = report;
        _options = options ?? new ScriptHostOptions();
        _runtime = new V8Runtime("cs2ts");
        _watchdog = new ScriptWatchdog(_options.Budget);

        try
        {
            Stripper = TypeStripper.Create(_runtime);
        }
        catch
        {
            _watchdog.Dispose();
            _runtime.Dispose();
            throw;
        }
    }

    /// <summary>Turns a plugin's TypeScript into JavaScript. Shared by every plugin.</summary>
    public TypeStripper Stripper { get; }

    /// <summary>Work waiting to run on the game thread.</summary>
    public FrameQueue Frames { get; } = new();

    /// <summary>The watchdog, for its interruption count.</summary>
    public ScriptWatchdog Watchdog => _watchdog;

    /// <summary>Names of the plugins currently loaded.</summary>
    public IReadOnlyCollection<string> Loaded
    {
        get
        {
            lock (_gate)
            {
                return _plugins.Keys.ToArray();
            }
        }
    }

    /// <summary>
    /// Called with each new plugin's engine before its code runs, to install whatever
    /// host API that plugin gets. Set once, before loading anything.
    /// </summary>
    public Action<ScriptPlugin, V8ScriptEngine>? Configure { get; set; }

    /// <summary>
    /// Called the first time any plugin registers a given command name, so that the
    /// binding can tell the server about it. Called once per name for the life of the
    /// host, not once per registration: a reload re-registers the same names, and a
    /// server command registered twice is answered twice.
    ///
    /// It is never called again for a name, even after every plugin that used it has
    /// gone. Unregistering would be tidier and is not worth the failure mode — a
    /// command the server has forgotten while a script still expects it is silent, and
    /// silence is the thing this project spends its effort avoiding. A command with no
    /// handlers left simply reports that nothing answers it.
    /// </summary>
    public Action<string>? CommandRegistered { get; set; }

    /// <summary>Command names any loaded plugin answers to, without the console prefix.</summary>
    public IReadOnlyCollection<string> KnownCommands
    {
        get
        {
            lock (_gate)
            {
                return _knownCommands.ToArray();
            }
        }
    }

    /// <summary>The plugin loaded under a name, or <c>null</c>.</summary>
    public ScriptPlugin? Find(string name)
    {
        lock (_gate)
        {
            return _plugins.GetValueOrDefault(name);
        }
    }

    /// <summary>
    /// Strips <paramref name="typeScript"/> and runs it as a plugin, replacing any
    /// plugin already loaded under the same name.
    ///
    /// A failure leaves nothing loaded under that name. Keeping the previous version
    /// running after a failed reload would be friendlier for about a minute and then
    /// deeply confusing: the file on disk and the code on the server would disagree.
    /// </summary>
    public PluginLoadResult Load(string name, string fileName, string typeScript)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentException.ThrowIfNullOrEmpty(fileName);
        ArgumentNullException.ThrowIfNull(typeScript);
        ObjectDisposedException.ThrowIf(_disposed, this);

        Unload(name);

        var stripped = Stripper.Strip(fileName, typeScript);
        if (!stripped.Succeeded)
        {
            return PluginLoadResult.Refused(name, stripped.Diagnostics);
        }

        ScriptPlugin plugin;
        try
        {
            plugin = ScriptPlugin.Create(
                _runtime,
                name,
                fileName,
                stripped.JavaScript!,
                _report,
                _options.Policy,
                _watchdog,
                Configure,
                OnCommandRegistered);
        }
        catch (Exception exception)
        {
            // The plugin's own top level threw, so it never finished loading. It is
            // reported like any other script error and the name stays free.
            var error = ScriptError.FromException(name, exception, isAsync: false);
            _report(error);
            return PluginLoadResult.Failed(name, error);
        }

        lock (_gate)
        {
            _plugins[name] = plugin;
        }

        return PluginLoadResult.Loaded(plugin);
    }

    /// <summary>
    /// Takes a plugin out of service and destroys its context, following the order the
    /// design sets out: drop queued work first so nothing can be drained mid-teardown,
    /// then dispose, which cancels the lifetime and takes pending promises with the
    /// context.
    /// </summary>
    public bool Unload(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);

        ScriptPlugin? plugin;
        lock (_gate)
        {
            if (!_plugins.Remove(name, out plugin))
            {
                return false;
            }
        }

        Frames.Discard(plugin);
        plugin.Dispose();
        return true;
    }

    /// <summary>
    /// Delivers an event to every plugin that registered for it, and returns how many
    /// handlers ran. A plugin that fails does not stop the next one.
    /// </summary>
    public int Dispatch(string eventName, params object?[] args)
    {
        ArgumentException.ThrowIfNullOrEmpty(eventName);

        if (_disposed)
        {
            return 0;
        }

        ScriptPlugin[] plugins;
        lock (_gate)
        {
            plugins = [.. _plugins.Values];
        }

        var ran = 0;
        foreach (var plugin in plugins)
        {
            ran += plugin.Dispatch(eventName, args);
        }

        return ran;
    }

    /// <summary>
    /// Runs a command and reports what became of it, in enough detail for the caller to
    /// say something true: nobody registered it, it ran, or it is switched off after
    /// repeated failures. Collapsing those into one number is how a command that threw
    /// came to report itself as unregistered.
    /// </summary>
    /// <param name="name">The command, without the console prefix.</param>
    /// <param name="player">Who ran it, or <c>null</c> from the server console.</param>
    /// <param name="args">Everything after the command itself.</param>
    public DispatchOutcome DispatchCommand(string name, object? player, string[] args)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentNullException.ThrowIfNull(args);
        ObjectDisposedException.ThrowIf(_disposed, this);

        ScriptPlugin[] plugins;
        lock (_gate)
        {
            plugins = [.. _plugins.Values];
        }

        var key = ScriptPlugin.HandlerKey(name);
        var outcome = default(DispatchOutcome);
        foreach (var plugin in plugins)
        {
            outcome += plugin.DispatchDetailed(key, player, args);
        }

        return outcome;
    }

    /// <summary>
    /// Notes a command name and passes it on the first time it is seen. Runs while a
    /// plugin is loading, on the game thread.
    /// </summary>
    private void OnCommandRegistered(string name)
    {
        lock (_gate)
        {
            if (!_knownCommands.Add(name))
            {
                return;
            }
        }

        CommandRegistered?.Invoke(name);
    }

    /// <summary>Runs whatever background work has come back. Call once per tick.</summary>
    public int DrainFrames() => Frames.Drain();

    /// <summary>Unloads every plugin, then tears down the runtime they shared.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        ScriptPlugin[] plugins;
        lock (_gate)
        {
            plugins = [.. _plugins.Values];
            _plugins.Clear();
        }

        foreach (var plugin in plugins)
        {
            plugin.Dispose();
        }

        // After the plugins, so that nothing is still being interrupted or stripped.
        _watchdog.Dispose();
        Stripper.Dispose();
        _runtime.Dispose();
    }
}
