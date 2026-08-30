using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// One of the game's objects, with every field it has on it and the few verbs that
/// apply to all of them.
///
/// The curated surface — <see cref="PlayerFacade{TController,TPawn}"/> and what comes
/// after it — is the product: a small number of members that do the right thing, name
/// what they do, and cannot be written wrongly. It will always be behind the game. This
/// type is the floor underneath it, so that "the facade does not cover it yet" is a
/// reason to write a slightly uglier line rather than a reason to stop.
///
/// A player has two of them and they are not interchangeable — a spectator has a
/// controller and no pawn, which is why <c>player.pawn</c> is nullable and the compiler
/// rather than the runtime is what says so. Everything else in the world is one of
/// these too: a weapon, the planted bomb, a door, a prop a script made itself.
///
/// It is a separate object from the player rather than more members on it for a second
/// reason as well. The generated surface is wide: putting two hundred members next to
/// the seventeen curated ones would bury them, while <c>pawn.raw.</c> asks for them by
/// name.
///
/// Like everything else a script can keep, it holds no entity. <see cref="Raw"/> is
/// built once and kept, but the object it is has a way to resolve the entity rather
/// than the entity itself.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class EntityFacade
{
    private readonly IEntityAccess _access;
    private readonly Func<bool> _isValid;
    private readonly string _description;

    /// <remarks>
    /// Public rather than internal, unlike <see cref="PlayerFacade{TController,TPawn}"/>'s,
    /// because everything it needs comes from the assembly that knows the game and only
    /// the assembly that does not can enforce a constructor. The rule it cannot enforce
    /// is worth stating instead: for anything with an identity, go through
    /// <see cref="EntityFacadeTable"/>. Two facades for one entity compare unequal in
    /// script, which is a failure that looks like nothing at all.
    /// </remarks>
    /// <param name="kind">What this is — "pawn", "controller", "entity".</param>
    /// <param name="description">What <c>toString</c> answers.</param>
    /// <param name="access">The game side: the wide surface, and the verbs.</param>
    /// <param name="isValid">
    /// Whether the entity is still there. Must not throw. It is passed in rather than
    /// asked of <paramref name="access"/> because for a pawn the answer is composed out
    /// of the player's own guards, and only one place should decide what counts as a
    /// player being in the world.
    /// </param>
    public EntityFacade(string kind, string description, IEntityAccess access, Func<bool> isValid)
    {
        Kind = kind;
        _access = access;
        _description = description;
        _isValid = isValid;
    }

    /// <summary>What this is — "pawn", "controller", "entity".</summary>
    [ScriptMember("kind")]
    public string Kind { get; }

    /// <summary>
    /// Whether the entity is still there: for a pawn, that the player is on the server
    /// and in the world; for anything else, that it has not been removed. The cheap
    /// check before touching <see cref="Raw"/>, and like the player's own guards it
    /// never throws.
    /// </summary>
    [ScriptMember("isValid")]
    public bool IsValid => _isValid();

    /// <summary>
    /// The entity's slot in the game's entity list — what the server console means by
    /// "entity 42", and the number to pass to <c>entities.byIndex</c>.
    ///
    /// Reading it is safe on a dead entity and answers -1 there, because an index is
    /// the sort of thing a script logs and a log line should not be the thing that
    /// throws.
    /// </summary>
    [ScriptMember("index")]
    public int Index => IsValid ? _access.Index : -1;

    /// <summary>
    /// The classname the map and the game use — "weapon_ak47", "planted_c4",
    /// "func_door". The one thing that says what an entity is, and the name
    /// <c>entities.find</c> searches by. Empty once the entity is gone.
    /// </summary>
    [ScriptMember("designerName")]
    public string DesignerName => IsValid ? _access.DesignerName : "";

    /// <summary>
    /// Every field the entity has, by name.
    ///
    /// Typed as <see cref="ScriptSurface"/> because this assembly does not know the game:
    /// the surface is made by the plugin, which does, and the base type is only there to
    /// keep <see cref="object"/>'s members off it.
    ///
    /// <see cref="ScriptMemberFlags.ExposeRuntimeType"/> is what makes that work and is
    /// not optional — ClearScript binds a member's value against its <em>declared</em>
    /// type by default, so without it a script would get the members of
    /// <see cref="ScriptSurface"/>, which is none of them: every field would read as
    /// undefined and every write would be dropped, with nothing thrown and nothing
    /// logged.
    /// </summary>
    [ScriptMember("raw", ScriptMemberFlags.ExposeRuntimeType)]
    public ScriptSurface Raw => _access.Raw;

    /// <summary>
    /// The wide surface for a named schema class: <c>entity.as("CAK47").clip1</c> reaches
    /// the weapon's own fields, where <see cref="Raw"/> is the floor every entity shares.
    ///
    /// An assertion, not a cast that is checked. The caller is saying the entity is of
    /// that class, and that is checked exactly as far as <c>unsafe</c> checks its class
    /// argument: the name has to be one the game binds, and a name that fits an entity of
    /// a different class reads that class's bytes at the same offsets rather than
    /// throwing. <see cref="Raw"/> stays the safe default; this is the typed way past it,
    /// and it replaces reaching a field through <c>unsafe</c> by name.
    ///
    /// Nothing is resolved here, so this does not throw for a dead entity — a read on the
    /// surface it returns does. A name the game does not bind throws instead.
    ///
    /// <see cref="ScriptMemberFlags.ExposeRuntimeType"/> for the reason given on
    /// <see cref="Raw"/>: the declared type is <see cref="ScriptSurface"/>, and binding
    /// against it would hand script an object with none of the fields on it.
    /// </summary>
    /// <exception cref="ArgumentException">No schema class of that name is bound.</exception>
    [ScriptMember("as", ScriptMemberFlags.ExposeRuntimeType)]
    public ScriptSurface As(string schemaClass) => _access.As(schemaClass);

    /// <summary>
    /// Where the entity is, copied out at the moment of the read: changing what comes
    /// back moves nothing.
    ///
    /// Null rather than a throw for an entity that has no place in the world yet, which
    /// is the state a freshly created entity is in until it is spawned — a case a
    /// script creating entities meets immediately, and one the compiler can make it
    /// answer. An entity that is <em>gone</em> is a different thing and throws.
    /// </summary>
    /// <exception cref="DeadEntityException">The entity is gone.</exception>
    [ScriptMember("position")]
    public ScriptVector? Position => _access.Position;

    /// <summary>
    /// Moves the entity, keeping its angles and velocity. Coordinates arrive as
    /// JavaScript numbers, which are doubles; the game works in floats, so the
    /// narrowing happens here rather than somewhere it would look like a bug.
    /// </summary>
    /// <exception cref="DeadEntityException">The entity is gone.</exception>
    [ScriptMember("teleport")]
    public void Teleport(double x, double y, double z) =>
        _access.Teleport((float)x, (float)y, (float)z);

    /// <summary>
    /// Brings a newly created entity into the world. Whatever was written to it before
    /// this call is what it starts life with, which is the only reason creation and
    /// spawning are two steps rather than one.
    /// </summary>
    /// <exception cref="DeadEntityException">The entity is gone.</exception>
    [ScriptMember("spawn")]
    public void Spawn() => _access.Spawn();

    /// <summary>
    /// Takes the entity out of the world. Everything referring to it — this object
    /// included — reads as invalid afterwards rather than as freed memory.
    /// </summary>
    /// <exception cref="DeadEntityException">The entity is gone.</exception>
    [ScriptMember("remove")]
    public void Remove() => _access.Remove();

    /// <summary>
    /// Fires one of the entity's map inputs, the same ones a level designer wires up in
    /// Hammer: "Kill", "TurnOn", "Open", "AddOutput". The value is what the input takes,
    /// and is empty for the many that take nothing.
    /// </summary>
    /// <exception cref="DeadEntityException">The entity is gone.</exception>
    [ScriptMember("input")]
    public void Input(string name, string? value = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        _access.Input(name, value ?? "");
    }

    /// <summary>
    /// The live CounterStrikeSharp object, or a throw.
    ///
    /// The escape hatch, and the same bargain as everywhere else: the facade will always
    /// be behind CounterStrikeSharp's surface, and a script that needs something not on
    /// it should have a way through rather than a dead end. Past this point the script
    /// owns its own validity checking.
    ///
    /// <see cref="ScriptMemberFlags.ExposeRuntimeType"/> for the reason given on
    /// <see cref="Raw"/>: the declared type here is <see cref="object"/>, and binding
    /// against it would hand script an object with nothing on it.
    /// </summary>
    /// <exception cref="DeadEntityException">The entity is gone.</exception>
    [ScriptMember("resolve", ScriptMemberFlags.ExposeRuntimeType)]
    public object Resolve() => _access.Resolve();

    /// <summary>"pawn of player:7", "weapon_ak47:42". Also what string interpolation
    /// gives a script.</summary>
    [ScriptMember("toString")]
    public override string ToString() => _description;

    /// <summary>
    /// Declared only to keep it off the script surface, for the reason spelled out on
    /// <see cref="PlayerFacade{TController,TPawn}.Equals"/>: opting out by default
    /// governs declared members, not inherited ones.
    /// </summary>
    public override bool Equals(object? obj) => base.Equals(obj);

    /// <inheritdoc cref="Equals" />
    public override int GetHashCode() => base.GetHashCode();
}
