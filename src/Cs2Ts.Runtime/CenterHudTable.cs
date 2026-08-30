namespace Cs2Ts.Runtime;

/// <summary>
/// The one line of centre-screen text a plugin is keeping in front of a player, held
/// there by re-sending it before the game lets it fade.
///
/// Centre text sent with PrintToCenterHtml disappears after a few seconds on its own, so
/// a message that is meant to stay has to be sent again on a schedule. That re-send loop
/// lives here rather than in a script because a script that forgot to stop it — or was
/// unloaded before it could — would leave text on a player's screen with nothing left to
/// clear it. Ownership works the way <see cref="TimerTable"/>'s does: an entry whose
/// plugin has gone is dropped, so a reload takes the previous version's message with it.
///
/// One entry per player. Two plugins writing to the same player is last-writer-wins:
/// there is a single centre slot on the client and nothing this side does makes it two.
/// </summary>
public sealed class CenterHudTable
{
    // Re-sent this often. Comfortably inside the few seconds the client keeps the text,
    // and far short of a rate that would cost anything against a 64 tick loop.
    private const double RefreshSeconds = 1.0;

    private readonly Lock _gate = new();
    private readonly Dictionary<long, Entry> _live = [];

    /// <summary>Messages dropped because their player left or their plugin was unloaded. Diagnostics.</summary>
    public long Dropped { get; private set; }

    /// <summary>How many players have a kept centre message right now. Diagnostics.</summary>
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
    /// Sets, or replaces, the kept centre message for one player. It is sent on the next
    /// <see cref="Tick"/> — the same tick, unless one has already run this frame.
    /// </summary>
    /// <param name="owner">The plugin the message belongs to.</param>
    /// <param name="playerId">The player's identity — their userid.</param>
    /// <param name="text">The HTML to show.</param>
    /// <remarks>
    /// Replacing an existing entry takes its ownership too: the last plugin to write a
    /// player's centre slot is the one whose unload clears it, and the one
    /// <see cref="Clear"/> then answers for.
    /// </remarks>
    public void Show(ScriptPlugin owner, long playerId, string text)
    {
        ArgumentNullException.ThrowIfNull(owner);
        ArgumentNullException.ThrowIfNull(text);

        lock (_gate)
        {
            _live[playerId] = new Entry(owner, text);
        }
    }

    /// <summary>
    /// Clears one player's kept centre message, if this plugin is the one showing it.
    /// Returns false when there is nothing there, or when another plugin owns it.
    /// </summary>
    /// <remarks>
    /// The owner is checked rather than assumed, for the same reason
    /// <see cref="TimerTable.Clear"/> checks it: without it one script could wipe
    /// another's message, which is a way to reach outside its own sandbox.
    /// </remarks>
    public bool Clear(ScriptPlugin owner, long playerId)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            if (_live.TryGetValue(playerId, out var entry) && ReferenceEquals(entry.Owner, owner))
            {
                _live.Remove(playerId);
                return true;
            }

            return false;
        }
    }

    /// <summary>
    /// Forgets every message belonging to one plugin. Called while unloading, so text a
    /// script left on a screen does not outlive the script that could take it back.
    /// </summary>
    public int Discard(ScriptPlugin owner)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            var doomed = _live
                .Where(pair => ReferenceEquals(pair.Value.Owner, owner))
                .Select(pair => pair.Key)
                .ToArray();

            foreach (var id in doomed)
            {
                _live.Remove(id);
            }

            Dropped += doomed.Length;
            return doomed.Length;
        }
    }

    /// <summary>
    /// Re-sends every message that has come due, and returns how many were sent. Call
    /// once per tick, on the game thread.
    /// </summary>
    /// <param name="now">The caller's monotonic clock — the one timers use.</param>
    /// <param name="send">
    /// Delivers one message to one player and answers whether the player was there for
    /// it. A false answer drops the entry: a player who has left has nothing on screen
    /// to keep refreshing, and no <see cref="Clear"/> call is coming for it.
    /// </param>
    public int Tick(double now, Func<long, string, bool> send)
    {
        ArgumentNullException.ThrowIfNull(send);

        (long Id, Entry Entry)[] due;
        lock (_gate)
        {
            due = _live
                .Where(pair => pair.Value.DueAt <= now)
                .Select(pair => (pair.Key, pair.Value))
                .ToArray();
        }

        if (due.Length == 0)
        {
            return 0;
        }

        var sent = 0;
        foreach (var (id, entry) in due)
        {
            var delivered = send(id, entry.Text);

            lock (_gate)
            {
                // Only touch the entry we actually sent: a Show between the snapshot and
                // here has replaced it with a fresh one whose schedule must not be
                // pushed out, and whose text has not been sent yet.
                if (!_live.TryGetValue(id, out var current) || !ReferenceEquals(current, entry))
                {
                    if (delivered)
                    {
                        sent++;
                    }

                    continue;
                }

                if (delivered)
                {
                    current.DueAt = now + RefreshSeconds;
                    sent++;
                }
                else
                {
                    _live.Remove(id);
                    Dropped++;
                }
            }
        }

        return sent;
    }

    private sealed class Entry(ScriptPlugin owner, string text)
    {
        public ScriptPlugin Owner { get; } = owner;

        public string Text { get; } = text;

        // Sent once now passes this. Starts in the past so the first tick after Show
        // delivers it rather than waiting a whole refresh interval.
        public double DueAt { get; set; } = double.NegativeInfinity;
    }
}
