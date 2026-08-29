using Cs2Ts.Runtime;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime.Tests;

public sealed class PlayerFacadeTests : IDisposable
{
    private readonly V8Runtime _runtime = new("facade-tests");
    private readonly V8ScriptEngine _engine;
    private readonly FakeWorld _world = new();
    private readonly FakeOperations _operations;
    private readonly PlayerFacadeTable<FakeController, FakePawn> _players;

    public PlayerFacadeTests()
    {
        // Same flags the host opens a plugin engine with: without HideHostExceptions a
        // script reads e.hostException and walks into the host from there.
        _engine = _runtime.CreateScriptEngine("facade-tests", V8ScriptEngineFlags.HideHostExceptions);
        _operations = new FakeOperations(_world);
        _players = new PlayerFacadeTable<FakeController, FakePawn>("player", _world.Resolve, _operations);
    }

    public void Dispose()
    {
        _engine.Dispose();
        _runtime.Dispose();
    }

    private PlayerFacade<FakeController, FakePawn> Expose(long userId, string name = "player")
    {
        var player = _players.For(userId);
        _engine.AddHostObject(name, player);
        return player;
    }

    [Fact]
    public void ReadsGoThroughToTheGame()
    {
        var controller = _world.Add(7, "murqin", 76561198123456789UL);
        controller.Pawn!.Health = 42;
        controller.Pawn.Armor = 50;

        var player = _players.For(7);

        Assert.Equal(7, player.Id);
        Assert.Equal("player", player.Kind);
        Assert.Equal("murqin", player.Name);
        Assert.Equal("76561198123456789", player.SteamId);
        Assert.Equal(3, player.Team);
        Assert.Equal(800, player.Money);
        Assert.Equal(42, player.Health);
        Assert.Equal(50, player.Armor);
        Assert.True(player.IsValid);
        Assert.True(player.IsAlive);
    }

    [Fact]
    public void ResolvesTheControllerOnEveryAccess()
    {
        _world.Add(7);
        var player = _players.For(7);

        var before = _world.Lookups;
        _ = player.Name;
        _ = player.Team;
        _ = player.Money;

        // Three reads, three lookups. A facade that cached the controller would show one.
        Assert.Equal(before + 3, _world.Lookups);
    }

    [Fact]
    public void ResolvesThePawnOnEveryAccess()
    {
        _world.Add(7);
        var player = _players.For(7);

        var before = _world.PawnLookups;
        _ = player.Health;
        _ = player.Armor;
        player.Health = 50;

        Assert.Equal(before + 3, _world.PawnLookups);
    }

    [Fact]
    public void SeesTheGameChangeUnderIt()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        Assert.Equal(100, player.Health);
        controller.Pawn!.Health = 1;
        Assert.Equal(1, player.Health);

        // The pawn is replaced, which is what a respawn is. Nothing is held across it.
        controller.Pawn = new FakePawn { Health = 75 };
        Assert.Equal(75, player.Health);
    }

    [Fact]
    public void WritesReachTheGame()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        player.Health = 55;
        player.Armor = 25;
        player.Money = 16000;

        Assert.Equal(55, controller.Pawn!.Health);
        Assert.Equal(25, controller.Pawn.Armor);
        Assert.Equal(16000, controller.Money);

        // Every write goes through the operations rather than around them, which is
        // what makes the plugin's one SetStateChanged helper unavoidable.
        Assert.Equal(["health=55", "armor=25", "money=16000"], _operations.Writes);
    }

    [Fact]
    public void APlayerWhoLeftThrowsSomethingScriptCanCatch()
    {
        _world.Add(7);
        var player = _players.For(7);
        _world.Disconnect(7);

        Assert.False(player.IsValid);
        Assert.False(player.IsAlive);
        Assert.Throws<DeadEntityException>(() => player.Name);
        Assert.Throws<DeadEntityException>(() => player.Health);
        Assert.Throws<DeadEntityException>(() => player.Health = 1);
        Assert.Throws<DeadEntityException>(() => player.SendChat("hi"));
    }

    [Fact]
    public void APlayerWithNoPawnIsValidButNotInTheWorld()
    {
        var controller = _world.Add(7);
        controller.Pawn = null;
        var player = _players.For(7);

        // The distinction the facade exists to keep: a spectator is still a player, so
        // their name and their money answer while their health cannot.
        Assert.True(player.IsValid);
        Assert.False(player.IsAlive);
        Assert.Equal("player", player.Name);
        Assert.Equal(800, player.Money);

        Assert.Throws<NoPawnException>(() => player.Health);
        Assert.Throws<NoPawnException>(() => player.Armor);
        Assert.Throws<NoPawnException>(() => player.Position);
        Assert.Throws<NoPawnException>(() => player.Teleport(0, 0, 0));
    }

    [Fact]
    public void APawnWithNoPlaceInTheWorldReadsAsNoPawn()
    {
        var controller = _world.Add(7);
        controller.Pawn!.Origin = null;
        var player = _players.For(7);

        // A pawn that exists but has not been placed is the same situation from a
        // script's side, and giving it a second name would only be a second thing to
        // handle.
        Assert.Throws<NoPawnException>(() => player.Position);
    }

    [Fact]
    public void DeadIsNotTheSameAsGone()
    {
        var controller = _world.Add(7);
        controller.Pawn!.Alive = false;
        controller.Pawn.Health = 0;
        var player = _players.For(7);

        Assert.True(player.IsValid);
        Assert.False(player.IsAlive);

        // A corpse still has a pawn, so all three read rather than throwing. Only Health
        // was pinned here before, and the declarations told authors that being dead was
        // "exactly the case that makes health, armor and position throw" — which a
        // server disproved for all three at once. The behaviour was right; the sentence
        // describing it was not.
        Assert.Equal(0, player.Health);
        Assert.Equal(0, player.Armor);
        Assert.NotNull(player.Position);
    }

    [Fact]
    public void TheGuardsNeverThrow()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        Assert.True(player.IsAlive);

        controller.Pawn = null;
        Assert.False(player.IsAlive);

        _world.Disconnect(7);
        Assert.False(player.IsValid);
        Assert.False(player.IsAlive);
    }

    [Fact]
    public void OnePlayerPerUserId()
    {
        _world.Add(7);

        Assert.Same(_players.For(7), _players.For(7));
        Assert.NotSame(_players.For(7), _players.For(8));

        // The identity outlives the player, so a reconnect on the same userid is the
        // same object a script stored earlier.
        _world.Disconnect(7);
        var afterLeaving = _players.For(7);
        _world.Add(7);
        Assert.Same(afterLeaving, _players.For(7));
    }

    [Fact]
    public void ClearingForgetsEverything()
    {
        _world.Add(7);
        var before = _players.For(7);
        Assert.Equal(1, _players.Count);

        _players.Clear();

        Assert.Equal(0, _players.Count);
        Assert.NotSame(before, _players.For(7));
    }

    [Fact]
    public void ResolveIsStillTheEscapeHatch()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        Assert.Same(controller, player.Resolve());

        _world.Disconnect(7);
        Assert.Throws<DeadEntityException>(() => player.Resolve());
    }

    [Fact]
    public void TeleportNarrowsToTheGameSNumbers()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        player.Teleport(1.5, -2.25, 64);

        var origin = controller.Pawn!.Origin!;
        Assert.Equal(1.5f, origin.X);
        Assert.Equal(-2.25f, origin.Y);
        Assert.Equal(64f, origin.Z);
    }

    [Fact]
    public void SendChatRefusesNothing()
    {
        _world.Add(7);
        var player = _players.For(7);

        Assert.Throws<ArgumentNullException>(() => player.SendChat(null!));
    }

    // ---- what this looks like from script ----

    [Fact]
    public void ScriptWritesHealthInOneStatement()
    {
        var controller = _world.Add(7);
        Expose(7);

        _engine.Execute("player.health = 100; player.armor = 50; player.money = 16000;");

        Assert.Equal(100, controller.Pawn!.Health);
        Assert.Equal(50, controller.Pawn.Armor);
        Assert.Equal(16000, controller.Money);
    }

    /// <summary>
    /// The facade gets the userid check for free, and this is where it matters most: a
    /// facade is the thing a script actually keeps — in a timer, in a Map, in a closure
    /// from five rounds ago. Resolving it to whoever inherited the userid would be a
    /// script healing, moving or paying a stranger with nothing in the log about it.
    /// </summary>
    [Fact]
    public void StopsResolvingWhenTheUseridHasBeenGivenToSomebodyElse()
    {
        _world.Add(7, "murqin", 76561198123456789UL);
        var player = _players.For(7);
        Assert.Equal("murqin", player.Name);

        _world.Disconnect(7);
        _world.Add(7, "stranger", 76561198000000002UL);

        Assert.False(player.IsValid);
        Assert.False(player.IsAlive);
        Assert.Throws<DeadEntityException>(() => player.Name);
        Assert.Throws<DeadEntityException>(() => player.Health = 100);
    }

    /// <summary>
    /// The same userid handed to the same person is still that person, so the facade
    /// starts working again. Stated as a test because the alternative — keeping it dead
    /// forever — is what the wording "the handle stays dead" would suggest, and it is
    /// not what this does or what it should do.
    /// </summary>
    [Fact]
    public void ResolvesAgainWhenTheOriginalPlayerComesBack()
    {
        _world.Add(7, "murqin", 76561198123456789UL);
        var player = _players.For(7);
        Assert.True(player.IsValid);

        _world.Disconnect(7);
        _world.Add(7, "stranger", 76561198000000002UL);
        Assert.False(player.IsValid);

        _world.Disconnect(7);
        _world.Add(7, "murqin", 76561198123456789UL);

        Assert.True(player.IsValid);
        Assert.Equal("murqin", player.Name);
    }

    /// <summary>
    /// Script sees the same refusal it sees for a player who simply left: a catchable
    /// Error, and isValid false beforehand. There is deliberately no separate signal for
    /// "somebody else has your userid" — from the script's side the player it was
    /// holding is gone either way.
    /// </summary>
    [Fact]
    public void ScriptSeesAReusedUseridAsAPlayerWhoLeft()
    {
        _world.Add(7, "murqin", 76561198123456789UL);
        Expose(7);
        Assert.Equal("murqin", _engine.Evaluate("player.name"));

        _world.Disconnect(7);
        _world.Add(7, "stranger", 76561198000000002UL);

        Assert.Equal(false, _engine.Evaluate("player.isValid"));
        Assert.Equal(
            "player 7 is no longer in the game",
            _engine.Evaluate("(() => { try { return player.name; } catch (e) { return e.message; } })()"));
    }

    [Fact]
    public void ScriptSeesAStringForSteamId()
    {
        _world.Add(7, steamId: 76561199123456789UL);
        Expose(7);

        Assert.Equal("string", _engine.Evaluate("typeof player.steamId"));
        Assert.Equal("76561199123456789", _engine.Evaluate("player.steamId"));
    }

    [Fact]
    public void ScriptCanCatchTheDeadPlayerError()
    {
        _world.Add(7);
        Expose(7);
        _world.Disconnect(7);

        var caught = _engine.Evaluate(
            """
            (() => {
                try {
                    player.health = 1;
                    return "no throw";
                } catch (e) {
                    return `${e instanceof Error} ${e.message}`;
                }
            })()
            """);

        Assert.Equal("true player 7 is no longer in the game", caught);
    }

    [Fact]
    public void ScriptCanCatchTheNotInTheWorldError()
    {
        var controller = _world.Add(7);
        controller.Pawn = null;
        Expose(7);

        var caught = _engine.Evaluate(
            """
            (() => {
                try {
                    return player.position.x;
                } catch (e) {
                    return e.message;
                }
            })()
            """);

        Assert.Equal("player 7 is not in the world right now; check isAlive first", caught);
    }

    [Fact]
    public void ScriptGetsACopyOfAPosition()
    {
        var controller = _world.Add(7);
        Expose(7);

        // A position is a copy, and writing to it fails loudly rather than quietly:
        // ClearScript refuses the assignment outright. That is the better of the two
        // outcomes — the alternative is a script that moves a player by assignment,
        // sees no error, and cannot work out why nothing happened.
        var refused = Assert.Throws<ScriptEngineException>(() => _engine.Execute("player.position.x = 999;"));
        Assert.Contains("property set", refused.Message);

        Assert.Equal(1f, controller.Pawn!.Origin!.X);
        Assert.Equal(1, _engine.Evaluate("player.position.x"));
    }

    [Fact]
    public void ScriptComparesPlayersWithTripleEquals()
    {
        _world.Add(7);
        _engine.AddHostObject("first", _players.For(7));
        _engine.AddHostObject("second", _players.For(7));
        _engine.AddHostObject("other", _players.For(8));

        Assert.Equal(true, _engine.Evaluate("first === second"));
        Assert.Equal(false, _engine.Evaluate("first === other"));
    }

    [Fact]
    public void ScriptSeesOnlyTheFacade()
    {
        _world.Add(7);
        Expose(7);

        // GetType is on every host object and cannot be hidden — it is part of
        // ClearScript's protocol. What keeps it harmless is AllowReflection staying
        // false, which EntityHandleTests pins directly.
        Assert.Equal(
            "GetType,armor,controller,health,id,isAlive,isBot,isValid,kind,money,name,pawn,position,resolve,sendChat,steamId,team,teleport,toString",
            _engine.Evaluate("Object.keys(player).sort().join(',')"));
    }

    [Fact]
    public void ScriptSeesOnlyThreeNumbersInAPosition()
    {
        _world.Add(7);
        Expose(7);

        Assert.Equal("GetType,toString,x,y,z", _engine.Evaluate("Object.keys(player.position).sort().join(',')"));
    }

    [Fact]
    public void ScriptGuardsReadTheWayTheDocumentationSaysTheyDo()
    {
        var controller = _world.Add(7);
        Expose(7);

        // The shape every example script uses: one cheap guard, then the work.
        _engine.Execute(
            """
            function heal() {
                if (!player.isAlive) {
                    return "skipped";
                }

                player.health = 100;
                return "healed";
            }
            """);

        Assert.Equal("healed", _engine.Evaluate("heal()"));

        controller.Pawn = null;
        Assert.Equal("skipped", _engine.Evaluate("heal()"));
    }
}
