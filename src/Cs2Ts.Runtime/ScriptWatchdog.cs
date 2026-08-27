using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime;

/// <summary>
/// Stops a runaway script from taking the server with it.
///
/// Scripts run inline on the game thread, so a handler that loops forever stops the
/// game loop. That is the accepted model — CounterStrikeSharp's C# plugins and SourceMod
/// behave the same way — but V8 offers a way out that native plugins do not have:
/// <see cref="V8ScriptEngine.Interrupt"/> is safe to call from another thread and makes
/// the running script throw. The plugin gets an error, the server keeps ticking.
///
/// The timer is armed only while a call is in flight, so an idle server pays nothing
/// for having a watchdog.
/// </summary>
public sealed class ScriptWatchdog : IDisposable
{
    private readonly TimeSpan _budget;
    private readonly Timer _timer;
    private readonly Lock _gate = new();

    private V8ScriptEngine? _running;

    // Distinguishes the call the timer was armed for from a later one. Without it, a
    // timer that fires just as a call finishes would interrupt whatever ran next.
    private long _sequence;
    private bool _disposed;

    /// <param name="budget">
    /// How long one crossing into script may take. It bounds a hang, not normal work:
    /// a handler measured in microseconds is nowhere near it, and a value tight enough
    /// to catch slow-but-working code would fire during a lag spike.
    /// </param>
    public ScriptWatchdog(TimeSpan budget)
    {
        if (budget <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(budget), budget, "The budget must be positive.");
        }

        _budget = budget;
        _timer = new Timer(_ => Fire(), null, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
    }

    /// <summary>How many calls have been interrupted. Diagnostics, and worth logging.</summary>
    public long Interruptions { get; private set; }

    /// <summary>
    /// Arms the watchdog for one call into <paramref name="engine"/>. Dispose the
    /// returned scope when the call returns.
    /// </summary>
    public IDisposable Guard(V8ScriptEngine engine)
    {
        ArgumentNullException.ThrowIfNull(engine);
        ObjectDisposedException.ThrowIf(_disposed, this);

        long sequence;
        lock (_gate)
        {
            _running = engine;
            sequence = ++_sequence;
        }

        _timer.Change(_budget, Timeout.InfiniteTimeSpan);
        return new Scope(this, sequence);
    }

    private void Fire()
    {
        V8ScriptEngine? target;
        lock (_gate)
        {
            target = _running;
            if (target is not null)
            {
                Interruptions++;
            }
        }

        // Called outside the lock: Interrupt blocks until the engine notices, and
        // holding the lock across it would deadlock the call trying to release.
        target?.Interrupt();
    }

    private void Release(long sequence)
    {
        lock (_gate)
        {
            if (sequence != _sequence)
            {
                // A later call is already being watched; releasing here would disarm it.
                return;
            }

            _running = null;
        }

        _timer.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
    }

    /// <summary>Stops watching. Any call in flight keeps running.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        lock (_gate)
        {
            _running = null;
        }

        _timer.Dispose();
    }

    private sealed class Scope(ScriptWatchdog watchdog, long sequence) : IDisposable
    {
        private bool _released;

        public void Dispose()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            watchdog.Release(sequence);
        }
    }
}
