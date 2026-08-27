using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// What happened to one call across the boundary.
/// </summary>
public enum BoundaryOutcome
{
    /// <summary>The script ran and returned.</summary>
    Completed,

    /// <summary>The script failed. It was reported; the caller was not disturbed.</summary>
    Failed,

    /// <summary>The handler was already disabled, so nothing was called.</summary>
    Skipped,
}

/// <summary>
/// The one place a CS2-TS plugin's script is allowed to be called from.
///
/// Every entry point goes through here because the callers are CounterStrikeSharp event
/// handlers, which are called from native code: an exception that escapes does not
/// produce a stack trace, it takes the server down. Nothing thrown by a script — and
/// nothing thrown by this layer either — is allowed past this class.
///
/// One boundary belongs to one plugin, so that everything it reports is already
/// attributed without the caller having to say who failed.
/// </summary>
public sealed class ScriptBoundary
{
    private readonly Action<ScriptError> _report;
    private readonly BoundaryPolicy _policy;
    private readonly TimeProvider _time;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, FailureHistory> _failures = [];

    /// <param name="pluginName">Named in every error this boundary reports.</param>
    /// <param name="report">
    /// Where errors go. It is called on the game thread and must not throw; if it does,
    /// the throw is swallowed, because a failing error reporter cannot be allowed to do
    /// what the error itself was prevented from doing.
    /// </param>
    /// <param name="policy">When a repeatedly failing handler is taken out of service.</param>
    /// <param name="time">Injectable clock; the flood window is measured against it.</param>
    public ScriptBoundary(
        string pluginName,
        Action<ScriptError> report,
        BoundaryPolicy? policy = null,
        TimeProvider? time = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(pluginName);
        ArgumentNullException.ThrowIfNull(report);

        PluginName = pluginName;
        _report = report;
        _policy = policy ?? BoundaryPolicy.Default;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>The plugin every error from this boundary is attributed to.</summary>
    public string PluginName { get; }

    /// <summary>Handlers this boundary has taken out of service.</summary>
    public IReadOnlyCollection<string> DisabledHandlers
    {
        get
        {
            lock (_gate)
            {
                return _failures.Where(e => e.Value.Disabled).Select(e => e.Key).ToArray();
            }
        }
    }

    /// <summary>True once a handler has failed past the policy's threshold.</summary>
    public bool IsDisabled(string handlerName)
    {
        lock (_gate)
        {
            return _failures.TryGetValue(handlerName, out var history) && history.Disabled;
        }
    }

    /// <summary>
    /// Clears a handler's failure record and puts it back in service. Reloading a plugin
    /// is the author saying they fixed it, so a reload must not inherit the old verdict.
    /// </summary>
    public void Reset(string? handlerName = null)
    {
        lock (_gate)
        {
            if (handlerName is null)
            {
                _failures.Clear();
            }
            else
            {
                _failures.Remove(handlerName);
            }
        }
    }

    /// <summary>
    /// Calls into script and contains anything that goes wrong.
    ///
    /// There is deliberately no Action overload. A script call's return value is not
    /// optional information: an async handler reports its failure through the promise
    /// it returns, so a call site that throws the result away turns every async
    /// failure into silence — the exact outcome this class exists to prevent. Callers
    /// with genuinely nothing to return say so by returning null.
    /// </summary>
    /// <param name="handlerName">
    /// Identifies the handler for flood protection and in the log, so it should stay
    /// stable across calls — an event name, or the exported function's name.
    /// </param>
    /// <param name="call">The script call to make.</param>
    public BoundaryOutcome Invoke(string handlerName, Func<object?> call) =>
        Invoke(handlerName, call, out _);

    /// <summary>
    /// Calls into script and contains anything that goes wrong, keeping the result.
    /// <paramref name="result"/> is left at its default when the call did not complete.
    /// </summary>
    /// <param name="handlerName">Identifies the handler for flood protection and in the log.</param>
    /// <param name="call">The script call to make.</param>
    /// <param name="result">What the script returned, when it returned.</param>
    /// <typeparam name="T">The script call's return type.</typeparam>
    public BoundaryOutcome Invoke<T>(string handlerName, Func<T> call, out T? result)
    {
        ArgumentException.ThrowIfNullOrEmpty(handlerName);
        ArgumentNullException.ThrowIfNull(call);

        result = default;

        if (IsDisabled(handlerName))
        {
            return BoundaryOutcome.Skipped;
        }

        try
        {
            result = call();
        }
        catch (Exception exception)
        {
            Fail(handlerName, ScriptError.FromException(PluginName, exception, isAsync: false));
            return BoundaryOutcome.Failed;
        }

        // An async handler returns before it fails. Without this the throw inside it
        // lands in V8's rejection queue, where nothing this process owns will ever look
        // at it, and the author sees a handler that silently does nothing.
        WatchIfPromise(handlerName, result);
        return BoundaryOutcome.Completed;
    }

    /// <summary>
    /// Reports a failure that happened outside a call this boundary made — the host's
    /// own dispatch code, or a callback handed to a script API.
    /// </summary>
    /// <param name="handlerName">Identifies the handler for flood protection and in the log.</param>
    /// <param name="exception">What went wrong.</param>
    /// <param name="isAsync">True when it surfaced after the originating call returned.</param>
    public void Report(string handlerName, Exception exception, bool isAsync = false)
    {
        ArgumentException.ThrowIfNullOrEmpty(handlerName);
        ArgumentNullException.ThrowIfNull(exception);

        Fail(handlerName, ScriptError.FromException(PluginName, exception, isAsync));
    }

    private void WatchIfPromise(string handlerName, object? result)
    {
        if (result is not ScriptObject promise)
        {
            return;
        }

        try
        {
            if (promise.GetProperty("then") is not ScriptObject)
            {
                return;
            }

            // The rejection handler is a host delegate, so the failure is attributed to
            // the same handler that started the work even though it arrives later, on
            // whatever turn the microtask queue drains.
            promise.InvokeMethod(
                "then",
                null,
                new Action<object?>(reason =>
                {
                    try
                    {
                        Fail(handlerName, ScriptError.FromRejection(PluginName, reason));
                    }
                    catch (Exception)
                    {
                        // This delegate runs inside V8. Letting it throw would turn a
                        // reported error into a second, unreported one.
                    }
                }));
        }
        catch (Exception exception)
        {
            // Attaching the watch is best effort: a thenable that misbehaves must not
            // turn a completed call into a failed one.
            SafeReport(ScriptError.FromException(PluginName, exception, isAsync: false));
        }
    }

    private void Fail(string handlerName, ScriptError error)
    {
        bool justDisabled;

        lock (_gate)
        {
            if (!_failures.TryGetValue(handlerName, out var history))
            {
                history = new FailureHistory();
                _failures[handlerName] = history;
            }

            justDisabled = history.Record(_time.GetUtcNow(), _policy);
        }

        SafeReport(error);

        if (justDisabled)
        {
            SafeReport(error with
            {
                Message =
                    $"handler '{handlerName}' failed {_policy.MaxFailures} times in " +
                    $"{_policy.Window.TotalSeconds:F0}s and has been disabled; reload the plugin to re-enable it",
            });
        }
    }

    private void SafeReport(ScriptError error)
    {
        try
        {
            _report(error);
        }
        catch (Exception)
        {
            // Nothing left to do with it. The boundary's contract is that it does not
            // throw, and that outranks delivering this particular message.
        }
    }

    /// <summary>
    /// A sliding window of failure times. Only the most recent
    /// <see cref="BoundaryPolicy.MaxFailures"/> are kept, because that is all the
    /// decision needs and a permanently failing handler would otherwise grow a list
    /// for as long as the server runs.
    /// </summary>
    private sealed class FailureHistory
    {
        private readonly Queue<DateTimeOffset> _times = new();

        public bool Disabled { get; private set; }

        /// <summary>Returns true only on the call that crosses the threshold.</summary>
        public bool Record(DateTimeOffset now, BoundaryPolicy policy)
        {
            if (Disabled)
            {
                return false;
            }

            _times.Enqueue(now);
            while (_times.Count > 0 && now - _times.Peek() > policy.Window)
            {
                _times.Dequeue();
            }

            if (_times.Count < policy.MaxFailures)
            {
                return false;
            }

            Disabled = true;
            return true;
        }
    }
}
