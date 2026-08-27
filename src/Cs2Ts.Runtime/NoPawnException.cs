namespace Cs2Ts.Runtime;

/// <summary>
/// Thrown when a script reads or writes something that lives on a player's pawn while
/// that player has none.
///
/// A connected player is not always in the world. Spectators, players who have not
/// spawned yet and players between a map change and the first round all have a
/// controller — <c>isValid</c> is true, their name and their money are there — and no
/// pawn, which is where health, armour and position live. Returning zero for those
/// would be a lie a script cannot detect; this is the same bargain
/// <see cref="DeadEntityException"/> makes, with <c>isAlive</c> as the cheap guard.
/// </summary>
public sealed class NoPawnException : Exception
{
    /// <param name="kind">What sort of entity it was — "player".</param>
    /// <param name="id">The identity that has no pawn.</param>
    public NoPawnException(string kind, long id)
        : base($"{kind} {id} is not in the world right now; check isAlive first")
    {
        Kind = kind;
        Id = id;
    }

    /// <summary>What sort of entity it was — "player" — for the message.</summary>
    public string Kind { get; }

    /// <summary>The identity that has no pawn.</summary>
    public long Id { get; }
}
