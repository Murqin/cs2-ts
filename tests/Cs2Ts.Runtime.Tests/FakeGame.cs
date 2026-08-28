using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

/// <summary>The half of a player that only exists while they are in the world.</summary>
public sealed class FakePawn
{
    public int Health { get; set; } = 100;

    public int Armor { get; set; }

    public bool Alive { get; set; } = true;

    public ScriptVector? Origin { get; set; } = new(1, 2, 3);
}

/// <summary>The half that survives death, and that a userid resolves to.</summary>
public sealed class FakeController
{
    public required string Name { get; set; }

    public required ulong SteamId { get; init; }

    public bool IsBot { get; init; }

    public int Team { get; set; } = 3;

    public int Money { get; set; } = 800;

    public FakePawn? Pawn { get; set; } = new();

    public bool IsValid { get; set; } = true;

    public List<string> Chat { get; } = [];
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

    public ScriptVector? GetPosition(FakePawn pawn) => pawn.Origin;

    public void Teleport(FakePawn pawn, float x, float y, float z)
    {
        pawn.Origin = new ScriptVector(x, y, z);
        Writes.Add($"teleport={x},{y},{z}");
    }
}
