namespace Cs2Ts.Runtime;

/// <summary>
/// Everything <see cref="PlayerFacade{TController,TPawn}"/> needs the game to do,
/// stated without naming CounterStrikeSharp.
///
/// The split is the same one the handle layer makes: this assembly owns the rules a
/// facade has to follow — resolve on every access, refuse a player who is not in the
/// world, hand back copies rather than views — and the plugin assembly owns the part
/// that only a running server can answer. That is what lets those rules be tested
/// against a fake game instead of a real one.
///
/// Implementations may assume every entity handed to them is live and valid; the
/// facade resolved it immediately before the call. They may not assume it still will
/// be afterwards, so they must not keep it.
/// </summary>
/// <typeparam name="TController">The persistent half of a player — name, money, team.</typeparam>
/// <typeparam name="TPawn">The half that exists only while the player is in the world.</typeparam>
public interface IPlayerOperations<TController, TPawn>
    where TController : class
    where TPawn : class
{
    /// <summary>
    /// The player's body, or null when they have none — spectating, not spawned yet,
    /// or between maps. Called on every access to a pawn-backed member, so it must be
    /// a lookup rather than anything cached.
    /// </summary>
    TPawn? FindPawn(TController controller);

    /// <summary>
    /// The game side of a controller: the wide surface — an object whose members are
    /// the entity's own fields, one per schema field, named as the game names them —
    /// together with the verbs that apply to any entity.
    ///
    /// It is made out here rather than in <see cref="EntityFacade"/> because the members
    /// are the game's, and this assembly is the one that is not allowed to know the
    /// game. What comes back is opaque to the runtime beyond <see cref="IEntityAccess"/>.
    ///
    /// <paramref name="resolve"/> hands back the live controller and throws once the
    /// player has left. It has to be called on every member access — the object being
    /// built here outlives any single entity, which is the whole reason it is given a
    /// way to look one up rather than one to hold.
    ///
    /// Called once per player and the result kept, so the cost per access is the lookup
    /// and not this.
    /// </summary>
    IEntityAccess AccessController(Func<TController> resolve);

    /// <summary>
    /// The same for a pawn. <paramref name="resolve"/> throws for a player who has left
    /// and for one who is not in the world, which is what makes a stored pawn safe to
    /// read across a respawn: it finds the new body, or it refuses.
    /// </summary>
    IEntityAccess AccessPawn(Func<TPawn> resolve);

    /// <summary>The name the player is showing right now.</summary>
    string GetName(TController controller);

    /// <summary>
    /// The player's Steam ID.
    ///
    /// A number rather than a string, even though script is given a string: this is
    /// read on every access as the handle's proof that the userid still belongs to the
    /// same person, and formatting it there would allocate on the game thread once per
    /// property read. The facade does the formatting, once, where the reason for it is.
    /// </summary>
    ulong GetSteamId(TController controller);

    /// <summary>Whether this is a bot rather than a person.</summary>
    bool IsBot(TController controller);

    /// <summary>The team number the player is on.</summary>
    int GetTeam(TController controller);

    /// <summary>How much money the player has.</summary>
    int GetMoney(TController controller);

    /// <summary>Sets the player's money, and tells the client about it.</summary>
    void SetMoney(TController controller, int money);

    /// <summary>Writes one line into the player's chat.</summary>
    void SendChat(TController controller, string message);

    /// <summary>Whether the pawn is alive, as opposed to a corpse or an observer.</summary>
    bool IsAlive(TPawn pawn);

    /// <summary>The pawn's health.</summary>
    int GetHealth(TPawn pawn);

    /// <summary>Sets the pawn's health, and tells the clients about it.</summary>
    void SetHealth(TPawn pawn, int health);

    /// <summary>The pawn's armour.</summary>
    int GetArmor(TPawn pawn);

    /// <summary>Sets the pawn's armour, and tells the clients about it.</summary>
    void SetArmor(TPawn pawn, int armor);

    /// <summary>
    /// Where the pawn is, copied out. Null when the pawn exists but is not placed in
    /// the world yet, which the facade reports the same way as having no pawn at all —
    /// from a script's side the two are the same situation.
    /// </summary>
    ScriptVector? GetPosition(TPawn pawn);

    /// <summary>Moves the pawn, leaving its view angles and velocity alone.</summary>
    void Teleport(TPawn pawn, float x, float y, float z);
}
