using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// A script's reference to something in the game: an identity, never a pointer.
///
/// Entities in CS2 are short-lived — a round change, a disconnect, a death or a map
/// change ends one — while a script's reference to one lives as long as the script
/// keeps it. Holding the resolved object across that gap is a use-after-free, so this
/// type holds only <see cref="Id"/> and looks the entity up again on every access.
///
/// The re-lookup is not free, and it is not negotiable: an API that is slower but does
/// not crash beats a faster one that does. It was measured at 0.40 µs against a live
/// server in phase 0, which is well inside a tick budget.
///
/// Only members marked with <see cref="ScriptMemberAttribute"/> are visible to script.
/// The class opts out by default so that adding a public member here cannot widen the
/// script-facing surface by accident.
/// </summary>
/// <typeparam name="TEntity">The host type the identity resolves to.</typeparam>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class EntityHandle<TEntity> : IEquatable<EntityHandle<TEntity>>
    where TEntity : class
{
    private readonly Func<long, TEntity?> _resolve;

    internal EntityHandle(string kind, long id, Func<long, TEntity?> resolve)
    {
        Kind = kind;
        Id = id;
        _resolve = resolve;
    }

    /// <summary>The durable identity. Survives everything the entity itself does not.</summary>
    [ScriptMember("id")]
    public long Id { get; }

    /// <summary>What sort of entity this refers to — "player", "entity".</summary>
    [ScriptMember("kind")]
    public string Kind { get; }

    /// <summary>
    /// Whether the entity is still there. The cheap check a script is expected to make
    /// before doing anything expensive:
    /// <code>if (!player.isValid) return;</code>
    /// </summary>
    [ScriptMember("isValid")]
    public bool IsValid => Lookup() is not null;

    /// <summary>
    /// The live entity, or a throw. This is also the escape hatch: what it returns is
    /// the host object itself, so a script that needs something the facade does not
    /// cover can reach past the facade — at the cost of doing its own validity
    /// checking from then on, which is why it is not the default way in.
    /// </summary>
    /// <exception cref="DeadEntityException">The entity has left the game.</exception>
    [ScriptMember("resolve")]
    public TEntity Resolve() => Lookup() ?? throw new DeadEntityException(Kind, Id);

    /// <summary>
    /// The live entity, or <c>null</c>. For host code on a hot path that would
    /// otherwise pay for an exception it is going to swallow anyway.
    /// </summary>
    public TEntity? Find() => Lookup();

    /// <summary>
    /// Runs <paramref name="action"/> against the live entity, or throws if it is gone.
    /// Host-side callers use this rather than holding what <see cref="Resolve"/>
    /// returns: a local that outlives the statement is the cached pointer this whole
    /// type exists to prevent.
    /// </summary>
    public void Use(Action<TEntity> action)
    {
        ArgumentNullException.ThrowIfNull(action);
        action(Resolve());
    }

    /// <summary>Reads a value from the live entity, or throws if it is gone.</summary>
    public TResult Read<TResult>(Func<TEntity, TResult> read)
    {
        ArgumentNullException.ThrowIfNull(read);
        return read(Resolve());
    }

    private TEntity? Lookup()
    {
        // A resolver that throws is a host bug, but it would reach script as a dead
        // entity and send the author looking at their own code. Letting it out keeps
        // the blame where ScriptBoundary can classify it.
        return _resolve(Id);
    }

    /// <summary>
    /// Handles for the same entity are the same handle, so that <c>===</c> works in
    /// script. Equality is by identity rather than by liveness: two references to a
    /// player who has since left are still references to the same player.
    /// </summary>
    public bool Equals(EntityHandle<TEntity>? other) =>
        other is not null && Id == other.Id && Kind == other.Kind;

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as EntityHandle<TEntity>);

    /// <inheritdoc />
    public override int GetHashCode() => HashCode.Combine(Kind, Id);

    /// <summary>"player:7". Also what a script gets from string interpolation.</summary>
    [ScriptMember("toString")]
    public override string ToString() => $"{Kind}:{Id}";
}
