using System.Globalization;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// A player, as a script is meant to use one.
///
/// <code>
/// player.health = 100;
/// player.sendChat("welcome back");
/// player.teleport(x, y, z);
/// </code>
///
/// The value here is not the shorter spelling. Written against CounterStrikeSharp
/// directly, the first line is two statements:
///
/// <code>
/// player.PlayerPawn.Value!.Health = 100;
/// Utilities.SetStateChanged(player.PlayerPawn.Value, "CBaseEntity", "m_iHealth");
/// </code>
///
/// and leaving the second one out compiles, runs, and changes the number the server
/// believes while every client keeps showing the old one. That is the class of bug
/// this type exists to make unwriteable: a facade earns its place by swallowing the
/// steps that fail silently when forgotten, not by saving keystrokes.
///
/// It holds an identity, never an entity. Every member resolves the player again, so a
/// facade kept across a round, a death or a disconnect stays safe — it starts throwing
/// something catchable instead of reading freed memory. Two cheap guards say which
/// situation a script is in without throwing: <c>isValid</c> for whether the player is
/// still on the server at all, <c>isAlive</c> for whether they are in the world.
///
/// What is not here is reachable anyway. <c>pawn</c> and <c>controller</c> lead to the
/// two entities behind a player with every field they have on them, so this type being
/// behind the game is a reason to write a longer line rather than a reason to stop. The
/// members here are the ones worth curating; that is the floor.
///
/// Only members marked <see cref="ScriptMemberAttribute"/> are visible to script, and
/// the type opts out by default so that adding a public member cannot widen that
/// surface by accident.
/// </summary>
/// <typeparam name="TController">The persistent half of a player.</typeparam>
/// <typeparam name="TPawn">The half that exists only while the player is in the world.</typeparam>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class PlayerFacade<TController, TPawn>
    where TController : class
    where TPawn : class
{
    private readonly EntityHandle<TController> _handle;
    private readonly IPlayerOperations<TController, TPawn> _operations;

    // Made on first use and kept. Neither holds an entity — each one holds a way to
    // look one up — so keeping them is what makes `player.pawn === player.pawn` true in
    // script without any of them outliving the body they were made for.
    private EntityFacade? _controllerEntity;
    private EntityFacade? _pawnEntity;

    internal PlayerFacade(EntityHandle<TController> handle, IPlayerOperations<TController, TPawn> operations)
    {
        _handle = handle;
        _operations = operations;
    }

    /// <summary>The durable identity: the player's userid.</summary>
    [ScriptMember("id")]
    public long Id => _handle.Id;

    /// <summary>What this refers to — "player".</summary>
    [ScriptMember("kind")]
    public string Kind => _handle.Kind;

    /// <summary>
    /// Whether the player is still on the server. The cheap check before anything that
    /// could throw; it never throws itself.
    /// </summary>
    [ScriptMember("isValid")]
    public bool IsValid => _handle.IsValid;

    /// <summary>
    /// Whether the player is alive and in the world. False for a spectator, for someone
    /// who has not spawned, for a corpse, and for a player who has left — so it is the
    /// one guard a script needs before touching health, armour or position, and like
    /// <see cref="IsValid"/> it never throws.
    /// </summary>
    [ScriptMember("isAlive")]
    public bool IsAlive =>
        _handle.Find() is { } controller &&
        _operations.FindPawn(controller) is { } pawn &&
        _operations.IsAlive(pawn);

    /// <summary>The name the player is showing right now.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("name")]
    public string Name => _operations.GetName(Controller);

    /// <summary>
    /// The player's Steam ID, as a string. A 64-bit id does not fit in a JavaScript
    /// number: above 2^53 it rounds, and the id it rounds to belongs to somebody else.
    /// </summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("steamId")]
    public string SteamId =>
        _operations.GetSteamId(Controller).ToString(CultureInfo.InvariantCulture);

    /// <summary>Whether this is a bot rather than a person.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("isBot")]
    public bool IsBot => _operations.IsBot(Controller);

    /// <summary>The team the player is on: 1 spectator, 2 T, 3 CT.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("team")]
    public int Team => _operations.GetTeam(Controller);

    /// <summary>The player's money. Writing it replicates to their client.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("money")]
    public int Money
    {
        get => _operations.GetMoney(Controller);
        set => _operations.SetMoney(Controller, value);
    }

    /// <summary>The pawn's health. Writing it replicates to every client.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    /// <exception cref="NoPawnException">The player is not in the world.</exception>
    [ScriptMember("health")]
    public int Health
    {
        get => _operations.GetHealth(Pawn);
        set => _operations.SetHealth(Pawn, value);
    }

    /// <summary>The pawn's armour. Writing it replicates to every client.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    /// <exception cref="NoPawnException">The player is not in the world.</exception>
    [ScriptMember("armor")]
    public int Armor
    {
        get => _operations.GetArmor(Pawn);
        set => _operations.SetArmor(Pawn, value);
    }

    /// <summary>Where the player is, copied out at the moment of the read.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    /// <exception cref="NoPawnException">The player is not in the world.</exception>
    [ScriptMember("position")]
    public ScriptVector Position =>
        _operations.GetPosition(Pawn) ?? throw new NoPawnException(_handle.Kind, _handle.Id);

    /// <summary>Writes one line into this player's chat, and nobody else's.</summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("sendChat")]
    public void SendChat(string message)
    {
        ArgumentNullException.ThrowIfNull(message);
        _operations.SendChat(Controller, message);
    }

    /// <summary>
    /// Moves the player, keeping their view angles and velocity. Coordinates arrive as
    /// JavaScript numbers, which are doubles; the game works in floats, so the
    /// narrowing happens here rather than somewhere it would look like a bug.
    /// </summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    /// <exception cref="NoPawnException">The player is not in the world.</exception>
    [ScriptMember("teleport")]
    public void Teleport(double x, double y, double z) =>
        _operations.Teleport(Pawn, (float)x, (float)y, (float)z);

    /// <summary>
    /// The player's controller: the half of them that persists, with every field it has.
    ///
    /// The floor under the curated surface. `player.money` is the way to read money;
    /// this is the way to read the two hundred things nobody has written a member for
    /// yet.
    ///
    /// Never null. Nullability on the two entities means one thing — "the player is not
    /// in the world" — and a controller is there for as long as the player is, so
    /// making this nullable too would cost every script a check that can never fail and
    /// would say nothing about the case that can.
    /// </summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("controller")]
    public EntityFacade ControllerEntity
    {
        get
        {
            // Resolved before the facade is handed over, so that a player who has left
            // fails on `player.controller` rather than one member later. Both are the
            // same failure; this one names the line the author actually wrote.
            _ = Controller;

            return _controllerEntity ??= new EntityFacade(
                "controller",
                $"controller of {this}",
                _operations.AccessController(() => Controller),
                () => _handle.Find() is not null);
        }
    }

    /// <summary>
    /// The player's pawn: their body, with every field it has. Null when they have none.
    ///
    /// The null is the point. A spectator, a player who has not spawned, a player
    /// between maps — none of them have a body, and today that is something a script
    /// finds out by having `player.health` throw at it. Here the compiler asks first,
    /// so the case is handled where it is cheap rather than discovered where it is not.
    ///
    /// Worth keeping in mind that null is an answer about this moment. A pawn read a
    /// tick ago can be gone now, so the members of what comes back still throw — being
    /// non-null is not a promise, it is an observation.
    /// </summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("pawn")]
    public EntityFacade? PawnEntity =>
        _operations.FindPawn(Controller) is null
            ? null
            : _pawnEntity ??= new EntityFacade(
                "pawn",
                $"pawn of {this}",
                _operations.AccessPawn(() => Pawn),
                () => _handle.Find() is { } controller && _operations.FindPawn(controller) is not null);

    /// <summary>
    /// The live CounterStrikeSharp controller, or a throw.
    ///
    /// The escape hatch, unchanged from the handle it wraps: the facade will always be
    /// behind CounterStrikeSharp's surface, and a script that needs something not on it
    /// should have a way through rather than a dead end. Past this point the script
    /// owns its own validity checking.
    /// </summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("resolve")]
    public TController Resolve() => _handle.Resolve();

    /// <summary>"player:7". Also what a script gets from string interpolation.</summary>
    [ScriptMember("toString")]
    public override string ToString() => _handle.ToString();

    /// <summary>
    /// Declared only so that it stays off the script surface.
    ///
    /// <see cref="DefaultScriptUsageAttribute"/> governs the members a type declares,
    /// not the ones it inherits: a host type that does not override Equals and
    /// GetHashCode hands both to script anyway. Nothing dangerous comes of it —
    /// reflection is prohibited separately — but the surface a script sees is meant to
    /// be exactly what is written here, and an inherited member arriving unannounced is
    /// how that stops being true.
    ///
    /// The behaviour is reference equality, unchanged. It is already the right answer,
    /// because the table hands out one facade per userid.
    /// </summary>
    public override bool Equals(object? obj) => base.Equals(obj);

    /// <inheritdoc cref="Equals" />
    public override int GetHashCode() => base.GetHashCode();

    /// <summary>
    /// The live controller. A property rather than a field so that every member above
    /// pays for a fresh lookup — the moment one of them holds this in a local that
    /// outlives the statement, the whole handle design is undone.
    /// </summary>
    private TController Controller => _handle.Resolve();

    /// <summary>
    /// The live pawn, or a throw a script can catch. Resolving the controller first is
    /// what makes the two failures distinguishable: a player who left and a player who
    /// is merely spectating are different problems with different fixes.
    /// </summary>
    private TPawn Pawn =>
        _operations.FindPawn(Controller) ?? throw new NoPawnException(_handle.Kind, _handle.Id);
}
