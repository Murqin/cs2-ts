namespace Cs2Ts.Runtime;

/// <summary>
/// Deferred and repeating work, owned by the plugin that asked for it.
///
/// Timers are a host API rather than a runtime feature: bare V8 has no clock and no
/// event loop, so <c>setTimeout</c> exists here or it does not exist. Everything runs on
/// the game thread, driven from the tick, which is the only place script is allowed to
/// touch the game.
///
/// The clock is a monotonic one supplied by the caller, deliberately not the game's
/// <c>Server.CurrentTime</c>. That counter is time since level load and it goes back to
/// zero on a map change, while scripts are not reloaded there — so every pending timer
/// would find its due time far in the future and silently never fire again. A clock that
/// cannot go backwards has no such case to get wrong.
///
/// Ownership works the way <see cref="FrameQueue"/>'s does: a timer whose plugin has been
/// unloaded is dropped rather than run, because a callback firing into a context that no
/// longer exists is one of the failures reloading is meant to stop, not cause.
/// </summary>
public sealed class TimerTable
{
    /// <summary>
    /// How many timers one plugin may have pending at once.
    ///
    /// "Timer accumulation" is on the list of things the lifecycle design exists to
    /// prevent, and the shape it takes in practice is a handler that sets a timer every
    /// time it runs and never clears one. Refusing the excess makes that a reported error
    /// at the line that caused it; without a cap it is a slow leak with no symptom.
    /// </summary>
    public const int MaxPerPlugin = 256;

    private readonly Lock _gate = new();
    private readonly Dictionary<long, Entry> _live = [];
    private readonly PriorityQueue<long, double> _due = new();
    private long _nextId = 1;

    /// <summary>Timers dropped because their plugin was gone. Diagnostics.</summary>
    public long Dropped { get; private set; }

    /// <summary>How many timers are pending. Diagnostics.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _live.Count;
            }
        }
    }

    /// <summary>
    /// Schedules work and returns the id that cancels it.
    /// </summary>
    /// <param name="owner">The plugin the timer belongs to.</param>
    /// <param name="delaySeconds">
    /// How long to wait. Negative is treated as zero — a caller asking for the past means
    /// "as soon as possible", and firing inside the same tick is not that.
    /// </param>
    /// <param name="repeating">Whether it reschedules itself after each run.</param>
    /// <param name="now">The current reading of the caller's monotonic clock.</param>
    /// <param name="work">Run on the game thread, inside the owner's boundary.</param>
    /// <exception cref="InvalidOperationException">
    /// The plugin already has <see cref="MaxPerPlugin"/> timers pending.
    /// </exception>
    public long Set(ScriptPlugin owner, double delaySeconds, bool repeating, double now, Func<object?> work)
    {
        ArgumentNullException.ThrowIfNull(owner);
        ArgumentNullException.ThrowIfNull(work);

        if (double.IsNaN(delaySeconds) || double.IsInfinity(delaySeconds))
        {
            throw new ArgumentOutOfRangeException(nameof(delaySeconds), "the delay must be a finite number");
        }

        var period = Math.Max(0, delaySeconds);

        lock (_gate)
        {
            var pending = 0;
            foreach (var entry in _live.Values)
            {
                if (ReferenceEquals(entry.Owner, owner))
                {
                    pending++;
                }
            }

            if (pending >= MaxPerPlugin)
            {
                throw new InvalidOperationException(
                    $"plugin '{owner.Name}' already has {MaxPerPlugin} timers pending; " +
                    "clear the ones it no longer needs");
            }

            var id = _nextId++;
            var label = $"{(repeating ? "setInterval" : "setTimeout")}#{id}";
            _live[id] = new Entry(owner, label, work, period, repeating)
            {
                Id = id,
                DueAt = now + period,
            };
            _due.Enqueue(id, now + period);
            return id;
        }
    }

    /// <summary>
    /// Cancels one timer. Returns false if it had already fired, was already cancelled,
    /// or belongs to a different plugin.
    /// </summary>
    /// <remarks>
    /// The owner is checked rather than assumed. Ids are handed out from one counter
    /// shared by every plugin, so without this a script could cancel another script's
    /// timers by guessing a number, which is a way out of its own sandbox.
    /// </remarks>
    public bool Clear(ScriptPlugin owner, long id)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            if (!_live.TryGetValue(id, out var entry) || !ReferenceEquals(entry.Owner, owner))
            {
                return false;
            }

            // Marked as well as removed: a timer already collected into the batch that
            // is running right now is no longer in _live to be found, and the run loop
            // reads this flag to know it must not call it after all.
            entry.Cancelled = true;
            _live.Remove(id);
            Compact();
            return true;
        }
    }

    /// <summary>
    /// Forgets every timer belonging to one plugin. Called while unloading, so a timer
    /// due in an hour does not keep the plugin's callback alive for an hour.
    /// </summary>
    public int Discard(ScriptPlugin owner)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            var doomed = _live.Where(e => ReferenceEquals(e.Value.Owner, owner)).ToArray();
            foreach (var (id, entry) in doomed)
            {
                entry.Cancelled = true;
                _live.Remove(id);
            }

            Dropped += doomed.Length;
            Compact();
            return doomed.Length;
        }
    }

    /// <summary>
    /// Runs everything due, on the calling thread, which must be the game thread.
    /// Returns how many callbacks actually ran.
    /// </summary>
    /// <param name="now">The current reading of the caller's monotonic clock.</param>
    /// <remarks>
    /// Only what is due when the tick starts is run. A callback that schedules another
    /// timer for zero seconds would otherwise be able to keep this loop going for the
    /// rest of the tick, which is a hang with extra steps — the same trap
    /// <see cref="FrameQueue.Drain"/> snapshots its batch to avoid.
    ///
    /// A repeating timer is rescheduled from <paramref name="now"/> rather than from when
    /// it was due, so a server that hitches for two seconds does not then fire a 100ms
    /// interval twenty times in one tick to catch up. Twenty runs back to back is never
    /// what the author wanted, and it arrives exactly when the server can least afford it.
    /// </remarks>
    public int Tick(double now)
    {
        List<Entry>? batch = null;

        lock (_gate)
        {
            while (_due.TryPeek(out var id, out var dueAt) && dueAt <= now)
            {
                _due.Dequeue();

                // Cleared or discarded since it was queued: the entry is gone from _live
                // and this queue slot is all that was left of it.
                if (!_live.TryGetValue(id, out var entry))
                {
                    continue;
                }

                (batch ??= []).Add(entry);

                if (entry.Repeating)
                {
                    entry.DueAt = now + entry.Period;
                    _due.Enqueue(id, entry.DueAt);
                }
                else
                {
                    // Left in _live until the batch has run, so that a callback earlier
                    // in the same batch can still cancel it.
                    entry.FiresOnce = true;
                }
            }
        }

        if (batch is null)
        {
            return 0;
        }

        var ran = 0;
        var dropped = 0;
        foreach (var entry in batch)
        {
            if (entry.Cancelled)
            {
                continue;
            }

            if (entry.Owner.Lifetime.IsCancellationRequested)
            {
                entry.Cancelled = true;
                dropped++;
                continue;
            }

            var outcome = entry.Owner.Run(entry.Label, entry.Work);
            if (outcome == BoundaryOutcome.Completed)
            {
                ran++;
            }
            else if (outcome == BoundaryOutcome.Skipped)
            {
                // The boundary has taken this handler out of service, or the plugin went
                // away mid-batch. Either way calling it again every period forever is
                // work with no possible outcome, so the timer stops here. A Failed one
                // keeps its schedule: one bad run is not a reason to cancel a job, and
                // the boundary is already counting towards disabling it.
                entry.Cancelled = true;
            }
        }

        lock (_gate)
        {
            foreach (var entry in batch)
            {
                if (entry.Cancelled || entry.FiresOnce)
                {
                    _live.Remove(entry.Id);
                }
            }

            Dropped += dropped;
            Compact();
        }

        return ran;
    }

    /// <summary>
    /// Rebuilds the due queue when cancelled timers have come to outnumber live ones.
    ///
    /// Cancelling does not remove anything from the queue — it cannot, a binary heap has
    /// no cheap removal — so a stale slot sits there until its due time passes. A script
    /// that sets and clears long timers in a loop would grow that queue without bound and
    /// without any timer being pending, which is a leak whose only symptom is memory.
    /// </summary>
    private void Compact()
    {
        if (_due.Count <= (_live.Count * 2) + 64)
        {
            return;
        }

        _due.Clear();
        foreach (var (id, entry) in _live)
        {
            _due.Enqueue(id, entry.DueAt);
        }
    }

    private sealed class Entry(ScriptPlugin owner, string label, Func<object?> work, double period, bool repeating)
    {
        public ScriptPlugin Owner { get; } = owner;

        public string Label { get; } = label;

        public Func<object?> Work { get; } = work;

        public double Period { get; } = period;

        public bool Repeating { get; } = repeating;

        public bool Cancelled { get; set; }

        public bool FiresOnce { get; set; }

        public long Id { get; init; }

        public double DueAt { get; set; }
    }
}
