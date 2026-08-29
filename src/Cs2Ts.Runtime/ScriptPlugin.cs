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
    private readonly HashSet<string> _commands = new(StringComparer.Ordinal);
    private Action<string>? _commandRegistered;
    private Action<string>? _eventRegistered;
    private TimerTable? _timers;
    private Func<double>? _clock;
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

    /// <summary>Command names this plugin answers to, without the console prefix.</summary>
    public IReadOnlyCollection<string> Commands
    {
        get
        {
            lock (_handlers)
            {
                return _commands.ToArray();
            }
        }
    }

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
        Action<ScriptPlugin, V8ScriptEngine>? configure,
        Action<string>? commandRegistered = null,
        Action<string>? eventRegistered = null,
        TimerTable? timers = null,
        Func<double>? clock = null)
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
        var plugin = new ScriptPlugin(name, fileName, engine, boundary, watchdog)
        {
            _commandRegistered = commandRegistered,
            _eventRegistered = eventRegistered,
            _timers = timers,
            _clock = clock,
        };

        try
        {
            // A delegate rather than a host object: ClearScript binds a host object's
            // members against the engine's access context, and a type private to this
            // class is not visible from it. A delegate sidesteps that and keeps the
            // bridge to exactly one callable.
            engine.Script.__cs2ts_register = new Action<string, ScriptObject>(plugin.AddEvent);
            engine.Script.__cs2ts_command = new Action<string, ScriptObject>(plugin.AddCommand);

            // Ids cross as doubles, not as the longs they are. ClearScript marshals an
            // Int64 to script as a host object rather than a number, and a timer id that
            // is not a number is one a script cannot compare, store in a Map, or hand
            // back without ceremony. Ids come off a counter that starts at 1, so the
            // exact range of a double is never in question.
            engine.Script.__cs2ts_set_timer = new Func<ScriptObject, double, bool, double>(plugin.SetTimer);
            engine.Script.__cs2ts_clear_timer = new Func<double, bool>(plugin.ClearTimer);
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
    ///
    /// The timer functions keep the names every JavaScript author already knows, and
    /// take milliseconds as those names imply. What they do not keep is the pretence of
    /// millisecond resolution: they are checked once per tick, so on a 64 tick server
    /// nothing fires more finely than about every 15ms. That is written down in
    /// <c>cs2ts.d.ts</c> rather than left to be discovered.
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

        globalThis.command = function command(name, handler) {
            if (typeof name !== "string" || name.length === 0) {
                throw new TypeError("command(): the name must be a non-empty string");
            }
            if (typeof handler !== "function") {
                throw new TypeError("command(): the handler must be a function");
            }
            __cs2ts_command(name, handler);
        };

        function __cs2ts_delay(who, delay) {
            if (delay === undefined) {
                return 0;
            }
            if (typeof delay !== "number" || !Number.isFinite(delay)) {
                throw new TypeError(who + "(): the delay must be a finite number of milliseconds");
            }
            return delay / 1000;
        }

        globalThis.setTimeout = function setTimeout(handler, delay) {
            if (typeof handler !== "function") {
                throw new TypeError("setTimeout(): the handler must be a function");
            }
            return __cs2ts_set_timer(handler, __cs2ts_delay("setTimeout", delay), false);
        };

        globalThis.setInterval = function setInterval(handler, delay) {
            if (typeof handler !== "function") {
                throw new TypeError("setInterval(): the handler must be a function");
            }
            return __cs2ts_set_timer(handler, __cs2ts_delay("setInterval", delay), true);
        };

        globalThis.clearTimeout = function clearTimeout(id) {
            return typeof id === "number" && __cs2ts_clear_timer(id);
        };

        globalThis.clearInterval = globalThis.clearTimeout;
        """;

    /// <summary>
    /// Schedules a script callback. The delay arrives in seconds: the prelude converts
    /// from the milliseconds an author writes, so the unit only exists at the edge.
    /// </summary>
    private double SetTimer(ScriptObject handler, double delaySeconds, bool repeating)
    {
        ArgumentNullException.ThrowIfNull(handler);

        if (_timers is null || _clock is null)
        {
            throw new InvalidOperationException(
                "timers are not available in this host; setTimeout and setInterval do nothing here");
        }

        return _timers.Set(this, delaySeconds, repeating, _clock(), () => handler.InvokeAsFunction());
    }

    /// <summary>
    /// Cancels one of this plugin's timers. Cancelling something that is not there is
    /// not an error in JavaScript and is not one here either.
    /// </summary>
    private bool ClearTimer(double id) => _timers is not null && _timers.Clear(this, (long)id);

    /// <summary>
    /// The key a command's handlers are stored under. Commands share the handler table
    /// with events, so unloading, reload, flood protection and the watchdog cover them
    /// without a second mechanism that would drift from the first. The prefix contains
    /// a character a script cannot put in an event name, so the two cannot collide.
    /// </summary>
    internal static string HandlerKey(string command) => $"command:{command}";

    /// <summary>
    /// Evaluates the plugin body. A throw here reaches the caller rather than the
    /// boundary: a plugin whose top level fails never loaded, and pretending otherwise
    /// leaves half-registered handlers behind.
    /// </summary>
    private void RunTopLevel(string javaScript)
    {
        using var guard = _watchdog?.Guard(_engine);
        // The name here is what every stack frame will carry, so it is the author's own
        // file name and nothing else. ClearScript may still decorate it — see
        // ScriptError, which undoes that — and IsTransient is not the way out: it
        // trades "vip [2].ts" for "vip.ts [temp]", which is the same problem wearing a
        // different suffix.
        _engine.Execute(new DocumentInfo(FileName), javaScript);
    }

    /// <summary>
    /// Calls every handler this plugin registered for an event. Returns how many ran.
    ///
    /// One failing handler does not stop the others, and does not reach the caller:
    /// the caller is a CounterStrikeSharp event running under native code.
    /// </summary>
    public int Dispatch(string eventName, params object?[] args) =>
        DispatchDetailed(eventName, args).Completed;

    /// <summary>
    /// The same dispatch, keeping what became of each handler. Commands need the
    /// detail: telling whoever typed one that nothing handled it is only true when
    /// nothing was registered, not when the handler ran and threw.
    /// </summary>
    public DispatchOutcome DispatchDetailed(string eventName, params object?[] args)
    {
        ArgumentException.ThrowIfNullOrEmpty(eventName);

        if (_disposed || _token.IsCancellationRequested)
        {
            return default;
        }

        Registration[] registrations;
        lock (_handlers)
        {
            if (!_handlers.TryGetValue(eventName, out var list))
            {
                return default;
            }

            registrations = [.. list];
        }

        var completed = 0;
        var failed = 0;
        var skipped = 0;
        foreach (var registration in registrations)
        {
            var outcome = Boundary.Invoke(registration.HandlerName, () =>
            {
                using var guard = _watchdog?.Guard(_engine);
                return registration.Handler.InvokeAsFunction(args);
            });

            switch (outcome)
            {
                case BoundaryOutcome.Completed:
                    completed++;
                    break;
                case BoundaryOutcome.Failed:
                    failed++;
                    break;
                default:
                    skipped++;
                    break;
            }
        }

        return new DispatchOutcome(completed, failed, skipped);
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

    /// <summary>
    /// Registers a chat and console command. The name is normalized first, so a bad one
    /// throws while the plugin is still loading — which stops the plugin rather than
    /// leaving a command that quietly never fires.
    /// </summary>
    private void AddCommand(string name, ScriptObject handler)
    {
        var normalized = CommandName.Normalize(name);

        lock (_handlers)
        {
            _commands.Add(normalized);
        }

        Add(HandlerKey(normalized), handler);

        // After the handler is in place: the host reacts by registering the command
        // with the server, and a command that exists before its handler does is a
        // command that can be run before it works.
        _commandRegistered?.Invoke(normalized);
    }

    /// <summary>
    /// Registers an event handler, and tells the host which event it was.
    ///
    /// The host needs to know because a game event costs nothing until somebody asks
    /// for it: the plugin layer hooks an event with the server the first time a script
    /// mentions it, and the two hundred and seventy events nobody listens to are never
    /// hooked at all. Same order as a command — the handler is in place before the
    /// server is told, so the first firing cannot arrive before something can answer it.
    /// </summary>
    private void AddEvent(string eventName, ScriptObject handler)
    {
        Add(eventName, handler);
        _eventRegistered?.Invoke(eventName);
    }

    /// <summary>Whether anything in this plugin is listening for an event.</summary>
    public bool Handles(string eventName)
    {
        lock (_handlers)
        {
            return _handlers.ContainsKey(eventName);
        }
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

        // Here rather than only in the host's unload path, so that every way a plugin can
        // end takes its timers with it — including a load that threw partway through, by
        // which point it may already have set some.
        _timers?.Discard(this);

        lock (_handlers)
        {
            _handlers.Clear();
            _commands.Clear();
        }

        _engine.Dispose();
        _lifetime.Dispose();
    }

    private sealed record Registration(ScriptObject Handler, string HandlerName);
}
