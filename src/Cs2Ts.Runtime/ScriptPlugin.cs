using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime;

/// <summary>
/// One loaded <c>.ts</c> plugin: its engine, its error boundary, its event
/// registrations and its lifetime.
///
/// Each plugin gets its own engine because V8 cannot unload a module — once a context
/// has evaluated something it keeps it for the life of the context, so the only way to
/// replace a plugin's code is to throw away the context it lives in. The engines share
/// one <see cref="V8Runtime"/>, so that is a new context rather than a new isolate.
///
/// The lifetime token is what makes unloading complete rather than approximate. Work
/// that was already in flight when the plugin went away — a queued frame callback, an
/// HTTP reply — checks the token and is dropped instead of running against code that
/// no longer exists.
/// </summary>
public sealed class ScriptPlugin : IDisposable
{
    private readonly V8ScriptEngine _engine;
    private readonly ScriptWatchdog? _watchdog;
    private readonly Dictionary<string, List<Registration>> _handlers = [];
    private readonly CancellationTokenSource _lifetime = new();

    // Captured at construction. CancellationTokenSource.Token throws once the source is
    // disposed, and the queue reads this token precisely to find out that the plugin is
    // gone — the one moment it must not throw.
    private readonly CancellationToken _token;
    private bool _disposed;

    private ScriptPlugin(string name, string fileName, V8ScriptEngine engine, ScriptBoundary boundary, ScriptWatchdog? watchdog)
    {
        Name = name;
        FileName = fileName;
        _engine = engine;
        Boundary = boundary;
        _watchdog = watchdog;
        _token = _lifetime.Token;
    }

    /// <summary>How this plugin is referred to in logs and in reload commands.</summary>
    public string Name { get; }

    /// <summary>The file it was loaded from, as it appears in stack traces.</summary>
    public string FileName { get; }

    /// <summary>Contains everything this plugin's script does.</summary>
    public ScriptBoundary Boundary { get; }

    /// <summary>
    /// Cancelled the moment the plugin starts unloading, before the engine is disposed.
    /// Anything holding deferred work for this plugin must check it first.
    /// </summary>
    public CancellationToken Lifetime => _token;

    /// <summary>Event names this plugin has registered a handler for.</summary>
    public IReadOnlyCollection<string> Events
    {
        get
        {
            lock (_handlers)
            {
                return _handlers.Keys.ToArray();
            }
        }
    }

    /// <summary>
    /// Builds an engine for one plugin and runs its stripped source in it.
    ///
    /// <paramref name="javaScript"/> is evaluated under <paramref name="fileName"/>, and
    /// that is not cosmetic: it is what puts the author's own file name and line numbers
    /// into V8's stack frames, which is the whole return on stripping types rather than
    /// compiling them.
    /// </summary>
    internal static ScriptPlugin Create(
        V8Runtime runtime,
        string name,
        string fileName,
        string javaScript,
        Action<ScriptError> report,
        BoundaryPolicy? policy,
        ScriptWatchdog? watchdog,
        Action<ScriptPlugin, V8ScriptEngine>? configure)
    {
        // HideHostExceptions keeps the .NET exception object off the Error a script
        // catches; without it e.hostException is a way out of the sandbox. Reflection is
        // already prohibited by default, and both matter — GetType is on every host
        // object and cannot be hidden.
        //
        // EnableArrayConversion turns a host API's array into a real JavaScript array.
        // Without it a script gets a host object whose length is Length and which has no
        // map or filter, which is a C# API wearing a JavaScript name — the exact thing
        // the facade exists to avoid.
        var engine = runtime.CreateScriptEngine(
            name,
            V8ScriptEngineFlags.HideHostExceptions | V8ScriptEngineFlags.EnableArrayConversion);
        var boundary = new ScriptBoundary(name, report, policy);
        var plugin = new ScriptPlugin(name, fileName, engine, boundary, watchdog);

        try
        {
            // A delegate rather than a host object: ClearScript binds a host object's
            // members against the engine's access context, and a type private to this
            // class is not visible from it. A delegate sidesteps that and keeps the
            // bridge to exactly one callable.
            engine.Script.__cs2ts_register = new Action<string, ScriptObject>(plugin.Add);
            engine.Execute(new DocumentInfo("cs2ts:prelude.js"), Prelude);
            configure?.Invoke(plugin, engine);

            plugin.RunTopLevel(javaScript);
            return plugin;
        }
        catch
        {
            plugin.Dispose();
            throw;
        }
    }

    /// <summary>
    /// The only globals a plugin starts with. <c>on</c> is a function rather than a
    /// host object member so that scripts can pass it around and so that the host
    /// object stays out of reach.
    /// </summary>
    private const string Prelude =
        """
        globalThis.on = function on(eventName, handler) {
            if (typeof eventName !== "string" || eventName.length === 0) {
                throw new TypeError("on(): the event name must be a non-empty string");
            }
            if (typeof handler !== "function") {
                throw new TypeError("on(): the handler must be a function");
            }
            __cs2ts_register(eventName, handler);
        };
        """;

    /// <summary>
    /// Evaluates the plugin body. A throw here reaches the caller rather than the
    /// boundary: a plugin whose top level fails never loaded, and pretending otherwise
    /// leaves half-registered handlers behind.
    /// </summary>
    private void RunTopLevel(string javaScript)
    {
        using var guard = _watchdog?.Guard(_engine);
        _engine.Execute(new DocumentInfo(FileName), javaScript);
    }

    /// <summary>
    /// Calls every handler this plugin registered for an event. Returns how many ran.
    ///
    /// One failing handler does not stop the others, and does not reach the caller:
    /// the caller is a CounterStrikeSharp event running under native code.
    /// </summary>
    public int Dispatch(string eventName, params object?[] args)
    {
        ArgumentException.ThrowIfNullOrEmpty(eventName);

        if (_disposed || _token.IsCancellationRequested)
        {
            return 0;
        }

        Registration[] registrations;
        lock (_handlers)
        {
            if (!_handlers.TryGetValue(eventName, out var list))
            {
                return 0;
            }

            registrations = [.. list];
        }

        var ran = 0;
        foreach (var registration in registrations)
        {
            var outcome = Boundary.Invoke(registration.HandlerName, () =>
            {
                using var guard = _watchdog?.Guard(_engine);
                return registration.Handler.InvokeAsFunction(args);
            });

            if (outcome == BoundaryOutcome.Completed)
            {
                ran++;
            }
        }

        return ran;
    }

    /// <summary>
    /// Runs host-supplied work against this plugin's engine, contained the same way a
    /// handler is. Used for deferred work — a queued frame callback — where the caller
    /// is not an event.
    /// </summary>
    public BoundaryOutcome Run(string handlerName, Func<object?> work)
    {
        ArgumentNullException.ThrowIfNull(work);

        if (_disposed || _token.IsCancellationRequested)
        {
            return BoundaryOutcome.Skipped;
        }

        return Boundary.Invoke(handlerName, () =>
        {
            using var guard = _watchdog?.Guard(_engine);
            return work();
        });
    }

    private void Add(string eventName, ScriptObject handler)
    {
        lock (_handlers)
        {
            if (!_handlers.TryGetValue(eventName, out var list))
            {
                list = [];
                _handlers[eventName] = list;
            }

            list.Add(new Registration(handler, $"{eventName}#{list.Count}"));
        }
    }

    /// <summary>
    /// Unloads the plugin, in the order the design requires: cancel first so nothing
    /// new is accepted, drop the registrations, then destroy the context. Pending
    /// promises and microtasks go with the context; anything queued outside it sees the
    /// cancelled token and is dropped rather than run.
    ///
    /// No native handle is released here, and that is not an omission: script objects
    /// hold identities rather than pointers, so there is nothing left to free.
    /// </summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _lifetime.Cancel();

        lock (_handlers)
        {
            _handlers.Clear();
        }

        _engine.Dispose();
        _lifetime.Dispose();
    }

    private sealed record Registration(ScriptObject Handler, string HandlerName);
}
