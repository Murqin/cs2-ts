namespace Cs2Ts.Runtime;

/// <summary>
/// The one-way road back from a worker thread to the game thread.
///
/// Scripts run inline where events fire, so anything genuinely asynchronous — HTTP, a
/// database, a webhook — happens on a thread pool and has to come back before it can
/// touch the game. There is no traffic in the other direction: the game thread never
/// waits on a worker.
///
/// Every posted callback carries the plugin it belongs to, and a callback whose plugin
/// has been unloaded is dropped rather than run. Without that, a reply that started
/// three seconds ago runs against a context that no longer exists — which is one of
/// the failures reloading is supposed to stop, not cause.
/// </summary>
public sealed class FrameQueue
{
    private readonly Lock _gate = new();
    private readonly Queue<Entry> _pending = new();

    /// <summary>Callbacks dropped because their plugin was gone by the time it ran.</summary>
    public long Dropped { get; private set; }

    /// <summary>How many callbacks are waiting. Diagnostics.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _pending.Count;
            }
        }
    }

    /// <summary>
    /// Queues work to run on the game thread. Safe to call from any thread; that is the
    /// point of it.
    /// </summary>
    /// <param name="owner">The plugin the work belongs to.</param>
    /// <param name="label">Names the work in errors and in flood protection.</param>
    /// <param name="work">Run on the game thread, inside the owner's boundary.</param>
    public void Post(ScriptPlugin owner, string label, Func<object?> work)
    {
        ArgumentNullException.ThrowIfNull(owner);
        ArgumentException.ThrowIfNullOrEmpty(label);
        ArgumentNullException.ThrowIfNull(work);

        lock (_gate)
        {
            _pending.Enqueue(new Entry(owner, label, work));
        }
    }

    /// <summary>
    /// Runs everything queued so far, on the calling thread, which must be the game
    /// thread. Returns how many callbacks actually ran.
    ///
    /// Only the callbacks queued when the drain started are run. A callback that queues
    /// another one would otherwise be able to keep the drain going for the rest of the
    /// tick, which is a hang with extra steps.
    /// </summary>
    public int Drain()
    {
        Entry[] batch;
        lock (_gate)
        {
            if (_pending.Count == 0)
            {
                return 0;
            }

            batch = [.. _pending];
            _pending.Clear();
        }

        var ran = 0;
        foreach (var entry in batch)
        {
            if (entry.Owner.Lifetime.IsCancellationRequested)
            {
                lock (_gate)
                {
                    Dropped++;
                }

                continue;
            }

            if (entry.Owner.Run(entry.Label, entry.Work) == BoundaryOutcome.Completed)
            {
                ran++;
            }
        }

        return ran;
    }

    /// <summary>
    /// Forgets everything queued for one plugin. Called while unloading, so that work
    /// already sitting in the queue does not have to wait for a drain to be discarded.
    /// </summary>
    public int Discard(ScriptPlugin owner)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            var kept = _pending.Where(e => !ReferenceEquals(e.Owner, owner)).ToArray();
            var removed = _pending.Count - kept.Length;

            _pending.Clear();
            foreach (var entry in kept)
            {
                _pending.Enqueue(entry);
            }

            Dropped += removed;
            return removed;
        }
    }

    private sealed record Entry(ScriptPlugin Owner, string Label, Func<object?> Work);
}
