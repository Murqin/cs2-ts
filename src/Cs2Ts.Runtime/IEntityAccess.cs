namespace Cs2Ts.Runtime;

/// <summary>
/// Everything the game lets a script do with one entity, stated without naming
/// CounterStrikeSharp.
///
/// The split is the one this assembly makes everywhere: the runtime owns the rules a
/// facade follows — resolve on every access, hand back copies rather than views, never
/// keep what was resolved — and the plugin owns the part only a running server can
/// answer. That is what lets the rules be tested against a fake game.
///
/// One instance per entity rather than one service that takes an entity, because the
/// thing it has to hold is a way to <em>find</em> the entity, and that is exactly what
/// the generated raw surfaces already hold. A stateless interface would have to be
/// handed a live entity by the caller, which is the cached pointer this whole design
/// exists to prevent.
/// </summary>
public interface IEntityAccess
{
    /// <summary>
    /// Every field the entity has, by name. Built once and kept — it holds the same way
    /// of resolving the entity, so it stays correct for as long as the entity does.
    /// </summary>
    ScriptSurface Raw { get; }

    /// <summary>
    /// The entity's index: its slot in the game's entity list, and the number the
    /// server console means by "entity 42".
    /// </summary>
    /// <remarks>
    /// It is not an identity and must not be kept as one. The game hands a slot back
    /// out when the entity in it is gone, so a stored index eventually names something
    /// else. What is safe to keep is the entity object itself, which knows the
    /// difference.
    /// </remarks>
    int Index { get; }

    /// <summary>
    /// The entity's classname as the map and the game call it — "weapon_ak47",
    /// "planted_c4", "func_door". The name to search by, and the one thing that says
    /// what an entity <em>is</em>.
    /// </summary>
    string DesignerName { get; }

    /// <summary>
    /// Where the entity is, copied out at the moment of the read. Null when it has no
    /// position in the world yet, which is the state a freshly created entity is in
    /// until it is spawned.
    /// </summary>
    ScriptVector? Position { get; }

    /// <summary>Moves the entity, leaving its angles and velocity alone.</summary>
    void Teleport(float x, float y, float z);

    /// <summary>
    /// Brings a newly created entity into the world. Everything set before this call is
    /// what the entity starts life with.
    /// </summary>
    void Spawn();

    /// <summary>Takes the entity out of the world.</summary>
    void Remove();

    /// <summary>
    /// Fires one of the entity's map inputs — "Kill", "TurnOn", "Open" — the same ones
    /// a level designer would wire up in Hammer.
    /// </summary>
    void Input(string name, string value);

    /// <summary>
    /// The live host object, or a throw. The escape hatch, and the same bargain as
    /// everywhere else: past this point the script does its own validity checking.
    /// </summary>
    object Resolve();
}
