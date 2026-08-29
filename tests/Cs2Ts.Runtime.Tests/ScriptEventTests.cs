using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// The two things the host owes the layer that hooks game events: which names scripts
/// have asked for, and whether anything is still listening for one.
///
/// Both exist for the same reason. There are two hundred and seventy-three game events
/// and a plugin usually wants three, so nothing is hooked with the server until a script
/// says the name, and nothing is built for an event once the script that wanted it is
/// gone. Neither is visible from a script, which is why they are tested here rather than
/// through one.
///
/// Its own host rather than the shared one: these set a callback on the host, and a
/// callback left on a fixture would be a test changing what the next test sees.
/// </summary>
public sealed class ScriptEventTests : IDisposable
{
    private readonly ScriptHost _host = new(_ => { });
    private readonly List<string> _asked = [];
    private readonly List<string> _said = [];

    public ScriptEventTests()
    {
        _host.EventRegistered = _asked.Add;

        // A delegate rather than a host object, for the reason the plugin loader gives:
        // ClearScript binds a host object's members against the engine's access context,
        // and a type private to a test is not visible from it.
        _host.Configure = (_, engine) => engine.Script.say = new Action<string>(_said.Add);
    }

    public void Dispose() => _host.Dispose();

    private void Load(string name, string source) =>
        Assert.True(_host.Load(name, $"{name}.js", source).Succeeded);

    [Fact]
    public void TheHostIsToldWhichEventsScriptsAskFor()
    {
        Load("a", """on("player_hurt", () => {}); on("bomb_planted", () => {});""");

        Assert.Equal(["player_hurt", "bomb_planted"], _asked);
    }

    [Fact]
    public void ANameIsReportedOnceForTheLifeOfTheHost()
    {
        Load("a", """on("player_hurt", () => {});""");
        Load("b", """on("player_hurt", () => {});""");

        // Hooking an event twice would deliver every firing twice, and a reload is the
        // ordinary way to get here: the same script asks for the same event again a
        // second after it was unloaded.
        _host.Unload("a");
        Load("a", """on("player_hurt", () => {});""");

        Assert.Equal(["player_hurt"], _asked);
    }

    [Fact]
    public void TheRuntimeSOwnEventIsReportedLikeAnyOther()
    {
        Load("a", """on("tick", () => {});""");

        // tick is not a game event, and the host does not know that — it has no list of
        // the game's events to check a name against. Deciding what a name means belongs
        // to the layer that knows the game, and this pins that the host does not try.
        Assert.Equal(["tick"], _asked);
    }

    [Fact]
    public void AMisspelledNameIsPassedAlongRatherThanSwallowed()
    {
        // The same reason. A name no event has is worth a warning, and the host cannot
        // be the one to give it, so it must at least not hide it.
        Load("a", """on("player_hrut", () => {});""");

        Assert.Equal(["player_hrut"], _asked);
    }

    [Fact]
    public void HandlesSaysWhetherAnybodyIsListening()
    {
        Assert.False(_host.Handles("player_hurt"));

        Load("a", """on("player_hurt", () => {});""");
        Assert.True(_host.Handles("player_hurt"));
        Assert.False(_host.Handles("bomb_planted"));

        // The half that matters at runtime: the hook outlives the script, so once the
        // script is gone the argument must stop being built.
        _host.Unload("a");
        Assert.False(_host.Handles("player_hurt"));
    }

    [Fact]
    public void OnePluginListeningIsEnough()
    {
        Load("a", """on("player_hurt", () => {});""");
        Load("b", """on("bomb_planted", () => {});""");

        Assert.True(_host.Handles("player_hurt"));
        Assert.True(_host.Handles("bomb_planted"));

        _host.Unload("b");
        Assert.True(_host.Handles("player_hurt"));
        Assert.False(_host.Handles("bomb_planted"));
    }

    [Fact]
    public void AnEventObjectReachesTheHandlerWholeAndIsSafeToKeep()
    {
        var world = new FakeWorld();
        world.Add(7, "murqin");
        var players = new PlayerFacadeTable<FakeController, FakePawn>("player", world.Resolve, new FakeOperations(world));

        Load("a", """
            let held = null;
            on("player_death", (e) => { held = e; });
            on("tick", () => { say(`${held.player.name} ${held.attacker === null} ${held.headshot} ${held.weapon}`); });
            """);

        Assert.Equal(1, _host.Dispatch(
            "player_death", new FakePlayerDeathEvent(players.For(7), null, true, "awp")));

        // Kept past the dispatch that delivered it and read a tick later. The values
        // were copied out while the event was live, so this is a snapshot; the player on
        // it is a facade, so it is still an identity rather than a freed pointer.
        Assert.Equal(1, _host.Dispatch("tick"));
        Assert.Equal(["murqin true true awp"], _said);
    }
}
