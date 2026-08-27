namespace Cs2Ts.Runtime;

/// <summary>
/// Thrown when a script touches an entity that has left the game.
///
/// This is the whole point of resolving on every access. The alternative — a cached
/// native pointer — turns the same script into a use-after-free, and the script in
/// question is the one every plugin author writes without thinking:
///
/// <code>
/// const p = event.player;
/// setTimeout(() => p.sendChat("hi"), 5000);   // p may be gone by then
/// </code>
///
/// ClearScript surfaces a host exception to script as a real Error instance — measured,
/// with the message intact and <c>instanceof Error</c> true — so a script can catch
/// this like anything else it wrote itself.
/// </summary>
public sealed class DeadEntityException : Exception
{
    /// <param name="kind">What sort of entity it was — "player", "entity".</param>
    /// <param name="id">The identity that no longer resolves.</param>
    public DeadEntityException(string kind, long id)
        : base($"{kind} {id} is no longer in the game")
    {
        Kind = kind;
        Id = id;
    }

    /// <summary>What sort of entity it was — "player", "entity" — for the message.</summary>
    public string Kind { get; }

    /// <summary>The durable identity that no longer resolves.</summary>
    public long Id { get; }
}
