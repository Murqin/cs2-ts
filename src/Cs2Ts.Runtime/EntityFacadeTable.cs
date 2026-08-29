namespace Cs2Ts.Runtime;

/// <summary>
/// Hands out entity facades and keeps them unique per entity.
///
/// One facade per entity is what makes <c>===</c> work in script: the weapon found in
/// a round-start handler is the same object as the one stored during the pickup, so an
/// author can compare them the way they would compare anything else. Valve's cs_script
/// gives map authors that property, and a scripting layer that does not feels broken in
/// a way that is hard to describe and easy to notice.
///
/// The identity is the game's own entity handle — an index together with a serial
/// number the game bumps every time it reuses that slot — and not the index on its own.
/// That distinction is the whole reason this table exists rather than a dictionary
/// keyed by index. Entity slots are recycled constantly: a round's grenades, dropped
/// weapons and ragdolls all give their indices back, and a table keyed by index would
/// hand out a facade made for last round's grenade as this round's weapon. The players'
/// table has the same problem with recycled userids and solves it by remembering a
/// second identity; here the game already put the serial number in the handle, so the
/// identity is simply complete to begin with.
///
/// The table holds identities, not entities, so a retained facade keeps nothing alive
/// in the game and cannot go stale in a dangerous way — a facade for an entity that has
/// been removed simply stops resolving.
/// </summary>
public sealed class EntityFacadeTable
{
    /// <summary>
    /// How many entries the table tolerates before it sweeps out the dead ones. Nothing
    /// depends on the exact number; it only has to be far enough above the number of
    /// entities a script touches in one frame that a sweep is not on the hot path.
    /// </summary>
    private const int FirstSweepAt = 256;

    private readonly Func<long, EntityFacade?> _create;
    private readonly Lock _gate = new();
    private readonly Dictionary<long, EntityFacade> _entities = [];
    private int _sweepAt = FirstSweepAt;

    /// <param name="create">
    /// Makes the facade for an entity handle, or answers null when nothing is there —
    /// the slot is empty, or it holds a different entity from the one this handle names.
    /// It is the plugin's, because the wide surface and the verbs on the far side of it
    /// are the game's.
    /// </param>
    public EntityFacadeTable(Func<long, EntityFacade?> create)
    {
        ArgumentNullException.ThrowIfNull(create);
        _create = create;
    }

    /// <summary>How many entities have been handed out. Diagnostics only.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _entities.Count;
            }
        }
    }

    /// <summary>
    /// The facade for an entity handle, creating it the first time and returning that
    /// same instance afterwards. Null when the handle names nothing.
    /// </summary>
    public EntityFacade? For(long handle)
    {
        lock (_gate)
        {
            if (_entities.TryGetValue(handle, out var existing))
            {
                // Not filtered on validity. A facade for a removed entity is still the
                // right answer for its own handle — it reports itself invalid — and
                // dropping it here would hand a second object to a script that had
                // already stored the first.
                return existing;
            }

            var entity = _create(handle);
            if (entity is null)
            {
                return null;
            }

            _entities[handle] = entity;

            if (_entities.Count >= _sweepAt)
            {
                Sweep();
            }

            return entity;
        }
    }

    /// <summary>
    /// Forgets every entity. Called when the engines that held these facades are gone —
    /// a reload — because nothing script-side can still be comparing them.
    /// </summary>
    public void Clear()
    {
        lock (_gate)
        {
            _entities.Clear();
            _sweepAt = FirstSweepAt;
        }
    }

    /// <summary>
    /// Drops the facades whose entities are gone.
    ///
    /// Unlike the players' table, this one is unbounded: a server has sixty-four
    /// userids for the life of a map and tens of thousands of entity handles, and a
    /// script that touches every grenade thrown in an hour would otherwise accumulate
    /// every one of them. Dropping a dead facade is safe in a way that dropping a live
    /// one would not be — the handle it was made for names a specific entity and that
    /// entity is gone, so no later lookup can ever be asking about it again.
    ///
    /// The threshold moves with the table so that the sweep stays amortised: a script
    /// that genuinely holds a thousand live entities pays for one wasted sweep rather
    /// than one per lookup from then on.
    /// </summary>
    private void Sweep()
    {
        // Removing during enumeration is allowed on Dictionary and has been since
        // .NET Core 3.0; it reads like a bug and is not one.
        foreach (var (handle, entity) in _entities)
        {
            if (!entity.IsValid)
            {
                _entities.Remove(handle);
            }
        }

        _sweepAt = Math.Max(FirstSweepAt, _entities.Count * 2);
    }
}
