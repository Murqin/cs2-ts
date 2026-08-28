namespace Cs2Ts.Runtime;

/// <summary>
/// Hands out handles and keeps them unique per identity.
///
/// One handle per identity is what makes <c>===</c> work in script: the player passed
/// to a round-start callback is the same object as the one stored during connect, so
/// an author can compare them the way they would compare anything else. Valve's
/// cs_script gives map authors that property, and a scripting layer that does not
/// feels broken in a way that is hard to describe and easy to notice.
///
/// The table holds identities, not entities, so a retained handle keeps nothing alive
/// in the game and cannot go stale in a dangerous way — a handle to a player who left
/// simply stops resolving.
/// </summary>
/// <typeparam name="TEntity">The host type identities resolve to.</typeparam>
public sealed class EntityHandleTable<TEntity> where TEntity : class
{
    private readonly Func<long, TEntity?> _resolve;
    private readonly Func<TEntity, long>? _witness;
    private readonly Lock _gate = new();
    private readonly Dictionary<long, EntityHandle<TEntity>> _handles = [];

    /// <param name="kind">What these handles refer to — "player", "entity".</param>
    /// <param name="resolve">
    /// Looks the entity up by identity and returns null when it is gone. It must also
    /// return null for an entity that exists but is no longer valid, since a script
    /// cannot tell the two apart and should not have to.
    /// </param>
    /// <param name="witness">
    /// A second identity, one that belongs to the thing itself rather than to the place
    /// it occupies — a player's Steam ID against their userid. A handle remembers what
    /// it saw the first time it resolved and stops resolving if that stops matching, so
    /// that a recycled userid cannot quietly turn a handle into a reference to somebody
    /// else. Optional: without one a handle trusts the resolver, which is the behaviour
    /// this table had before.
    /// </param>
    public EntityHandleTable(string kind, Func<long, TEntity?> resolve, Func<TEntity, long>? witness = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(kind);
        ArgumentNullException.ThrowIfNull(resolve);

        Kind = kind;
        _resolve = resolve;
        _witness = witness;
    }

    /// <summary>What these handles refer to — "player", "entity".</summary>
    public string Kind { get; }

    /// <summary>How many identities have been handed out. Diagnostics only.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _handles.Count;
            }
        }
    }

    /// <summary>
    /// The handle for an identity, creating it the first time and returning that same
    /// instance afterwards. Cheap enough to call on every event: after the first call
    /// it is a dictionary lookup, and it does not resolve the entity.
    /// </summary>
    public EntityHandle<TEntity> For(long id)
    {
        lock (_gate)
        {
            if (_handles.TryGetValue(id, out var existing))
            {
                return existing;
            }

            var handle = new EntityHandle<TEntity>(Kind, id, _resolve, _witness);
            _handles[id] = handle;
            return handle;
        }
    }

    /// <summary>
    /// Forgets every identity. Called when the engine that held these handles is gone —
    /// a plugin reload — because nothing script-side can still be comparing them.
    ///
    /// It is deliberately not called on map change. Handles are small and hold no
    /// entity, and dropping them mid-session would break <c>===</c> between a handle a
    /// script stored and one it is handed afterwards.
    /// </summary>
    public void Clear()
    {
        lock (_gate)
        {
            _handles.Clear();
        }
    }
}
