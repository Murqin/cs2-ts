using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// What every object in the fake world has, because every object in the real one does:
/// a slot, a classname, and somewhere to be. It is the fake's stand-in for CBaseEntity,
/// and it exists so that one <see cref="FakeEntityAccess"/> can serve a pawn, a
/// controller and a loose entity, exactly as one CssEntityAccess does.
/// </summary>
public interface IFakeEntity
{
    int Index { get; }

    string DesignerName { get; }

    ScriptVector? Origin { get; set; }

    /// <summary>Verbs that reached the game, in order, for tests that care one did.</summary>
    List<string> Verbs { get; }
}

/// <summary>The half of a player that only exists while they are in the world.</summary>
public sealed class FakePawn : IFakeEntity
{
    public int Health { get; set; } = 100;

    public int Armor { get; set; }

    public bool Alive { get; set; } = true;

    public ScriptVector? Origin { get; set; } = new(1, 2, 3);

    public int Index { get; init; } = 11;

    public string DesignerName => "player";

    public List<string> Verbs { get; } = [];
}

/// <summary>The half that survives death, and that a userid resolves to.</summary>
public sealed class FakeController : IFakeEntity
{
    public ScriptVector? Origin { get; set; }

    public int Index { get; init; } = 1;

    public string DesignerName => "cs_player_controller";

    public List<string> Verbs { get; } = [];

    public required string Name { get; set; }

    public required ulong SteamId { get; init; }

    public bool IsBot { get; init; }

    public int Team { get; set; } = 3;

    public int Money { get; set; } = 800;

    public FakePawn? Pawn { get; set; } = new();

    public bool IsValid { get; set; } = true;

    public List<string> Chat { get; } = [];

    /// <summary>Centre-screen lines this player has been sent, in order.</summary>
    public List<string> Center { get; } = [];
}

/// <summary>
/// A game a test can kill players in.
///
/// It counts lookups because the rule the facade has to follow — never keep what it
/// resolved — is a claim about how often the game is asked, not about what comes back.
/// A cached controller passes every value assertion and fails the counts.
/// </summary>
public sealed class FakeWorld
{
    private readonly Dictionary<long, FakeController> _players = [];

    /// <summary>How many times a userid has been turned into a controller.</summary>
    public int Lookups { get; private set; }

    /// <summary>How many times a controller has been asked for its pawn.</summary>
    public int PawnLookups { get; set; }

    /// <summary>Userids that resolve right now.</summary>
    public IEnumerable<long> Connected =>
        _players.Where(entry => entry.Value.IsValid).Select(entry => entry.Key).Order();

    public FakeController Add(long userId, string name = "player", ulong steamId = 76561198000000000UL)
    {
        var controller = new FakeController { Name = name, SteamId = steamId };
        _players[userId] = controller;
        return controller;
    }

    public FakeController this[long userId] => _players[userId];

    public void Disconnect(long userId) => _players.Remove(userId);

    /// <summary>
    /// The resolver a table is built on. It answers null for a player who left and for
    /// one who is still in the dictionary but no longer valid, because a script cannot
    /// tell those apart and should not have to.
    /// </summary>
    public FakeController? Resolve(long userId)
    {
        Lookups++;
        return _players.TryGetValue(userId, out var player) && player.IsValid ? player : null;
    }
}

/// <summary>
/// The game half of the facade, faked.
///
/// Everything CounterStrikeSharp would do here is one call. What the facade is
/// responsible for — resolving first, refusing a player who is not in the world,
/// handing back a copy of a position — is what the tests are about, and it is all on
/// the other side of this interface.
/// </summary>
public sealed class FakeOperations(FakeWorld world) : IPlayerOperations<FakeController, FakePawn>
{
    /// <summary>Every write, in order, for tests that care that one happened at all.</summary>
    public List<string> Writes { get; } = [];

    public FakePawn? FindPawn(FakeController controller)
    {
        world.PawnLookups++;
        return controller.Pawn;
    }

    public string GetName(FakeController controller) => controller.Name;

    public ulong GetSteamId(FakeController controller) => controller.SteamId;

    public bool IsBot(FakeController controller) => controller.IsBot;

    public int GetTeam(FakeController controller) => controller.Team;

    public int GetMoney(FakeController controller) => controller.Money;

    public void SetMoney(FakeController controller, int money)
    {
        controller.Money = money;
        Writes.Add($"money={money}");
    }

    public void SendChat(FakeController controller, string message) => controller.Chat.Add(message);

    public void SendCenter(FakeController controller, string message) => controller.Center.Add(message);

    public bool IsAlive(FakePawn pawn) => pawn.Alive;

    public int GetHealth(FakePawn pawn) => pawn.Health;

    public void SetHealth(FakePawn pawn, int health)
    {
        pawn.Health = health;
        Writes.Add($"health={health}");
    }

    public int GetArmor(FakePawn pawn) => pawn.Armor;

    public void SetArmor(FakePawn pawn, int armor)
    {
        pawn.Armor = armor;
        Writes.Add($"armor={armor}");
    }

    public IEntityAccess AccessController(Func<FakeController> resolve) =>
        new FakeEntityAccess(new FakeControllerRaw(resolve), resolve);

    public IEntityAccess AccessPawn(Func<FakePawn> resolve) =>
        new FakeEntityAccess(new FakePawnRaw(resolve), resolve);

    public ScriptVector? GetPosition(FakePawn pawn) => pawn.Origin;

    public void Teleport(FakePawn pawn, float x, float y, float z)
    {
        pawn.Origin = new ScriptVector(x, y, z);
        Writes.Add($"teleport={x},{y},{z}");
    }
}

/// <summary>
/// What a generated raw surface looks like from the runtime's side: it holds a way to
/// resolve the entity, never the entity itself, and every member goes through it.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class FakePawnRaw(Func<FakePawn> resolve) : ScriptSurface
{
    /// <summary>How often a member has asked for the entity. The rule is once per access.</summary>
    public int Resolutions { get; private set; }

    [ScriptMember("health")]
    public int Health
    {
        get { Resolutions++; return resolve().Health; }
        set { Resolutions++; resolve().Health = value; }
    }

    [ScriptMember("armorValue")]
    public int ArmorValue
    {
        get { Resolutions++; return resolve().Armor; }
        set { Resolutions++; resolve().Armor = value; }
    }
}

[DefaultScriptUsage(ScriptAccess.None)]
public sealed class FakeControllerRaw(Func<FakeController> resolve) : ScriptSurface
{
    [ScriptMember("score")]
    public int Score
    {
        get => resolve().Money;
        set => resolve().Money = value;
    }
}

/// <summary>
/// What a generated event payload looks like from the runtime's side: a snapshot, with
/// every player on it a facade rather than the game's own object.
///
/// The real ones are generated into the plugin assembly, which this one is not allowed
/// to know. These carry only the fields the sample scripts read — enough for a script to
/// be run rather than merely compiled.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class FakeRoundStartEvent(double timeLimit) : ScriptSurface
{
    [ScriptMember("timelimit")]
    public double Timelimit { get; } = timeLimit;
}

/// <summary>An event that carries one player, which is most of them.</summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class FakePlayerEvent(PlayerFacade<FakeController, FakePawn>? player) : ScriptSurface
{
    [ScriptMember("player")]
    public PlayerFacade<FakeController, FakePawn>? Player { get; } = player;
}

/// <summary>
/// A death, with the fields that made generating events worth doing: who did it, with
/// what, and whether it was a headshot. The attacker is null when the world did it.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class FakePlayerDeathEvent(
    PlayerFacade<FakeController, FakePawn>? player,
    PlayerFacade<FakeController, FakePawn>? attacker,
    bool headshot,
    string weapon) : ScriptSurface
{
    [ScriptMember("player")]
    public PlayerFacade<FakeController, FakePawn>? Player { get; } = player;

    [ScriptMember("attacker")]
    public PlayerFacade<FakeController, FakePawn>? Attacker { get; } = attacker;

    [ScriptMember("headshot")]
    public bool Headshot { get; } = headshot;

    [ScriptMember("weapon")]
    public string Weapon { get; } = weapon;
}

/// <summary>
/// The game side of an entity, faked. Everything CounterStrikeSharp would do here is
/// one call; what the facade is responsible for is on the other side of this interface.
///
/// It resolves on every member for the same reason the real one does, and the tests that
/// count lookups are what hold it to that.
/// </summary>
/// <param name="remove">
/// What removing actually does to the world, for the fake that has a world to take
/// something out of. Without it removal is only recorded — which is all a player's own
/// two entities can honestly report here, since the player fake takes them away by
/// disconnecting rather than by this.
/// </param>
public sealed class FakeEntityAccess(
    ScriptSurface raw,
    Func<IFakeEntity> resolve,
    Action<IFakeEntity>? remove = null,
    Func<string, ScriptSurface>? asSurface = null) : IEntityAccess
{
    public ScriptSurface Raw { get; } = raw;

    public ScriptSurface As(string schemaClass) =>
        asSurface?.Invoke(schemaClass)
        ?? throw new ArgumentException($"the fake game has no surface for a schema class called '{schemaClass}'");

    public int Index => resolve().Index;

    public string DesignerName => resolve().DesignerName;

    public ScriptVector? Position => resolve().Origin;

    public void Teleport(float x, float y, float z)
    {
        var entity = resolve();
        entity.Origin = new ScriptVector(x, y, z);
        entity.Verbs.Add($"teleport={x},{y},{z}");
    }

    public void Spawn() => resolve().Verbs.Add("spawn");

    public void Remove()
    {
        var entity = resolve();
        entity.Verbs.Add("remove");
        remove?.Invoke(entity);
    }

    public void Input(string name, string value) => resolve().Verbs.Add($"input:{name}={value}");

    public object Resolve() => resolve();
}

/// <summary>
/// Something in the world that is not a player: a weapon, a prop, the bomb.
///
/// It carries a serial number next to its index because that is what the real handle
/// does, and the difference between the two is the thing <see cref="EntityFacadeTable"/>
/// exists to get right — a slot is reused, a slot plus a serial is not.
/// </summary>
public sealed class FakeEntity : IFakeEntity
{
    public required int Index { get; init; }

    /// <summary>How many times this slot has been used. The game bumps it; here a test does.</summary>
    public required int Serial { get; init; }

    public required string DesignerName { get; init; }

    public ScriptVector? Origin { get; set; } = new(0, 0, 0);

    /// <summary>One of the fields the wide surface writes through to.</summary>
    public int TeamNum { get; set; }

    public List<string> Verbs { get; } = [];

    /// <summary>
    /// The identity: the slot with the serial packed above it, laid out as the game
    /// lays it out — fifteen bits of index, the rest serial.
    /// </summary>
    public long Handle => (uint)Index | ((long)Serial << 15);
}

/// <summary>
/// A world a test can create and destroy entities in, and the table over it.
///
/// The resolver is the point of the fake: it looks up by index and then refuses a
/// handle whose serial does not match what is in the slot now, which is exactly what
/// the game's own handle lookup does and what makes a stored reference safe.
/// </summary>
public sealed class FakeEntityWorld
{
    private readonly Dictionary<int, FakeEntity> _slots = [];
    private int _nextSerial = 1;

    public FakeEntityWorld() => Table = new EntityFacadeTable(Create);

    public EntityFacadeTable Table { get; }

    /// <summary>How many times a handle has been turned into an entity.</summary>
    public int Lookups { get; private set; }

    /// <summary>Puts an entity in a slot, taking the next serial number for it.</summary>
    public FakeEntity Spawn(int index, string designerName = "prop_physics")
    {
        var entity = new FakeEntity
        {
            Index = index,
            Serial = _nextSerial++,
            DesignerName = designerName,
        };

        _slots[index] = entity;
        return entity;
    }

    /// <summary>Empties a slot. Anything holding a handle to what was in it is now stale.</summary>
    public void Destroy(int index) => _slots.Remove(index);

    /// <summary>The facade for an entity, the way the plugin's own lookups get one.</summary>
    public EntityFacade? For(FakeEntity entity) => Table.For(entity.Handle);

    /// <summary>The entity in a slot, or null when the slot is empty.</summary>
    public EntityFacade? ByIndex(int index) =>
        _slots.TryGetValue(index, out var entity) ? For(entity) : null;

    /// <summary>Every entity with exactly this classname.</summary>
    public EntityFacade[] Find(string designerName) =>
        [.. _slots.Values
            .Where(entity => entity.DesignerName == designerName)
            .OrderBy(entity => entity.Index)
            .Select(For)
            .OfType<EntityFacade>()];

    /// <summary>Everything in the world.</summary>
    public EntityFacade[] All() =>
        [.. _slots.Values.OrderBy(entity => entity.Index).Select(For).OfType<EntityFacade>()];

    /// <summary>Makes one, in the first free slot, the way the game would.</summary>
    public EntityFacade Make(string designerName)
    {
        var index = 1;
        while (_slots.ContainsKey(index))
        {
            index++;
        }

        return For(Spawn(index, designerName))!;
    }

    private FakeEntity? Resolve(long handle)
    {
        Lookups++;
        var index = (int)(handle & 0x7FFF);
        return _slots.TryGetValue(index, out var entity) && entity.Handle == handle ? entity : null;
    }

    private EntityFacade? Create(long handle)
    {
        if (Resolve(handle) is not { } entity)
        {
            return null;
        }

        FakeEntity Live() => Resolve(handle) ?? throw new DeadEntityException("entity", handle & 0x7FFF);

        // Stands in for the generated factory: one name the fake game "binds", everything
        // else refused the way a real unknown schema class is.
        ScriptSurface As(string schemaClass) => schemaClass == "FakeEntity"
            ? new FakeEntityRaw(Live)
            : throw new ArgumentException($"nothing bound as '{schemaClass}'");

        return new EntityFacade(
            "entity",
            $"{entity.DesignerName}:{entity.Index}",
            new FakeEntityAccess(new FakeEntityRaw(Live), Live, gone => Destroy(gone.Index), As),
            () => Resolve(handle) is not null);
    }
}

/// <summary>The wide surface an entity gets, faked down to the fields a test reads.</summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class FakeEntityRaw(Func<FakeEntity> resolve) : ScriptSurface
{
    [ScriptMember("teamNum")]
    public int TeamNum
    {
        get => resolve().TeamNum;
        set => resolve().TeamNum = value;
    }
}
