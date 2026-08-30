using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// Runs whole scripts end to end: stripped, loaded, and dispatched to.
///
/// The scripts live in fixtures/ and are ordinary scripts rather than assertions —
/// which is the point. Every other test here holds one part of the runtime still and
/// pokes at it; these need stripping, dispatch, timers, reload and the command path to
/// agree all at once, the way they have to on a server. The node suite compiles the
/// same three files against the shipped tsconfig, so they cannot quietly become
/// something an author could not have written.
///
/// The host API is faked here because the real one lives in the CounterStrikeSharp
/// binding, which needs a server. What is not faked is the shape: if a script starts
/// using something the binding does not install, this stops running.
/// </summary>
public sealed class SampleScriptTests : IDisposable
{
    [DefaultScriptUsage(ScriptAccess.None)]
    public sealed class FakeConsole
    {
        public List<string> Lines { get; } = [];

        [ScriptMember("log")]
        public void Log(object? value) => Lines.Add(value?.ToString() ?? "null");

        [ScriptMember("warn")]
        public void Warn(object? value) => Lines.Add($"warning: {value}");

        [ScriptMember("error")]
        public void Error(object? value) => Lines.Add($"error: {value}");
    }

    [DefaultScriptUsage(ScriptAccess.None)]
    public sealed class FakeServer(ScriptPlugin plugin, FrameQueue frames)
    {
        [ScriptMember("nextFrame")]
        public void NextFrame(ScriptObject callback) =>
            frames.Post(plugin, "server.nextFrame", () => callback.InvokeAsFunction());

        [ScriptMember("command")]
        public void Command(string command) => Commands.Add(command);

        [ScriptMember("mapName")]
        public string MapName => "de_dust2";

        [ScriptMember("currentTime")]
        public float CurrentTime => 12.5f;

        public List<string> Commands { get; } = [];
    }

    [DefaultScriptUsage(ScriptAccess.None)]
    public sealed class FakePlayers(PlayerFacadeTable<FakeController, FakePawn> table, FakeWorld world)
    {
        [ScriptMember("byUserId")]
        public PlayerFacade<FakeController, FakePawn> ByUserId(int userId) => table.For(userId);

        [ScriptMember("all")]
        public PlayerFacade<FakeController, FakePawn>[] All() =>
            world.Connected.Select(table.For).ToArray();
    }

    /// <summary>
    /// The <c>entities</c> global, faked. The plugin's own is the same four questions
    /// asked of a live server; what a script sees is this shape either way.
    /// </summary>
    [DefaultScriptUsage(ScriptAccess.None)]
    public sealed class FakeEntities(FakeEntityWorld world)
    {
        [ScriptMember("byIndex")]
        public EntityFacade? ByIndex(int index) => world.ByIndex(index);

        [ScriptMember("find")]
        public EntityFacade[] Find(string designerName) => world.Find(designerName);

        [ScriptMember("first")]
        public EntityFacade? First(string designerName) => world.Find(designerName).FirstOrDefault();

        [ScriptMember("all")]
        public EntityFacade[] All() => world.All();

        [ScriptMember("create")]
        public EntityFacade Create(string designerName) => world.Make(designerName);
    }

    /// <summary>
    /// The <c>hud</c> global, faked. It is the real <see cref="CenterHudTable"/> behind a
    /// shape generic over the fake player types — the binding's own HudApi is the same
    /// two lines over CounterStrikeSharp's.
    /// </summary>
    [DefaultScriptUsage(ScriptAccess.None)]
    public sealed class FakeHud(ScriptPlugin plugin, CenterHudTable table)
    {
        [ScriptMember("show")]
        public void Show(PlayerFacade<FakeController, FakePawn> player, string text) =>
            table.Show(plugin, player.Id, text);

        [ScriptMember("clear")]
        public void Clear(PlayerFacade<FakeController, FakePawn> player) =>
            table.Clear(plugin, player.Id);
    }

    private readonly FakeWorld _world = new();
    private readonly FakeEntityWorld _entities = new();
    private readonly PlayerFacadeTable<FakeController, FakePawn> _table;
    private readonly FakeConsole _console = new();
    private readonly List<ScriptError> _errors = [];
    private readonly ScriptHost _host;
    private FakeServer _server = null!;
    private double _now;

    public SampleScriptTests()
    {
        _table = new PlayerFacadeTable<FakeController, FakePawn>(
            "player", _world.Resolve, new FakeOperations(_world));

        _host = new ScriptHost(_errors.Add, new ScriptHostOptions(Clock: () => _now));
        _host.Configure = (plugin, engine) =>
        {
            engine.AddHostObject("console", _console);
            _server = new FakeServer(plugin, _host!.Frames);
            engine.AddHostObject("server", _server);
            engine.AddHostObject("players", new FakePlayers(_table, _world));
            engine.AddHostObject("entities", new FakeEntities(_entities));
            engine.AddHostObject("hud", new FakeHud(plugin, _host!.CenterHud));
        };
    }

    public void Dispose() => _host.Dispose();

    private PluginLoadResult LoadExample()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "welcome.ts");
        return _host.Load("welcome", "welcome.ts", File.ReadAllText(path));
    }

    private PluginLoadResult LoadTimerExample()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "timers.ts");
        return _host.Load("timers", "timers.ts", File.ReadAllText(path));
    }

    /// <summary>
    /// The folder plugin, loaded the way the binding loads one: found by discovery
    /// rather than named, so the fixture proves the rules and the loader agree.
    /// </summary>
    private PluginLoadResult LoadJetpackExample()
    {
        var source = PluginDiscovery.Find(AppContext.BaseDirectory, _console.Lines.Add)
            .Single(plugin => plugin.Name == "jetpack");

        return _host.Load(source, File.ReadAllText(source.EntryPath));
    }

    private PluginLoadResult LoadEntityExample()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "entities.ts");
        return _host.Load("entities", "entities.ts", File.ReadAllText(path));
    }

    private PluginLoadResult LoadHudExample()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "hud.ts");
        return _host.Load("hud", "hud.ts", File.ReadAllText(path));
    }

    /// <summary>Moves the clock and runs the tick, the way the game loop would.</summary>
    private int Advance(double seconds)
    {
        _now += seconds;
        return _host.AdvanceTimers();
    }

    /// <summary>
    /// Runs the centre-message re-send the way the game loop would, delivering each one
    /// into the player's own <see cref="FakeController.Center"/> list.
    /// </summary>
    private int RefreshHud() =>
        _host.RefreshCenterHud((id, text) =>
        {
            if (_world.Resolve(id) is not { } controller)
            {
                return false;
            }

            controller.Center.Add(text);
            return true;
        });

    [Fact]
    public void TheSampleScriptLoadsAndHandlesEvents()
    {
        var result = LoadExample();
        Assert.True(result.Succeeded, string.Join("; ", result.Report()));

        var controller = _world.Add(7, "murqin");
        controller.Pawn!.Health = 3;
        controller.Pawn.Armor = 0;

        Assert.Equal(1, _host.Dispatch("round_start", new FakeRoundStartEvent(115)));
        Assert.Equal(1, _host.Dispatch("round_start", new FakeRoundStartEvent(115)));
        Assert.Equal(1, _host.Dispatch("player_connect_full", new FakePlayerEvent(_table.For(7))));
        Assert.Equal(1, _host.Dispatch("player_spawn", new FakePlayerEvent(_table.For(7))));
        Assert.Equal(1, _host.Dispatch("player_death", new FakePlayerDeathEvent(_table.For(7), null, false, "ak47")));

        Assert.Contains("round 1 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("round 2 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("murqin spawned at 1, 2, 3 with $800", _console.Lines);
        Assert.Contains("murqin died to the world (ak47); 1 still connected", _console.Lines);
        Assert.Equal(["welcome, murqin"], controller.Chat);

        // The example's round_start heals everyone who is in the world, and the whole
        // point of writing it that way is that one statement is enough.
        Assert.Equal(100, controller.Pawn.Health);
        Assert.Equal(100, controller.Pawn.Armor);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// The example's point: it holds a handle across a frame boundary. With a cached
    /// pointer this is where a server crashes; here the callback simply sees isValid
    /// go false and returns.
    /// </summary>
    [Fact]
    public void TheDeferredCallbackSurvivesThePlayerLeaving()
    {
        Assert.True(LoadExample().Succeeded);
        var controller = _world.Add(7, "murqin");

        _host.Dispatch("player_connect_full", new FakePlayerEvent(_table.For(7)));
        _world.Disconnect(7);

        Assert.Equal(1, _host.DrainFrames());

        Assert.Equal(["welcome, murqin"], controller.Chat);
        Assert.DoesNotContain(_console.Lines, line => line.Contains("still here on the next frame"));
        Assert.Empty(_errors);
    }

    /// <summary>
    /// The timer example, run rather than merely compiled: the reminder waits, the
    /// warmup countdown counts, and the interval stops itself.
    /// </summary>
    [Fact]
    public void TheTimerExampleWaitsAndThenFires()
    {
        Assert.True(LoadTimerExample().Succeeded);
        var controller = _world.Add(7, "murqin");

        Assert.Equal(1, _host.Dispatch("round_start", new FakeRoundStartEvent(115)));

        // Nothing at 29 seconds. The reminder is a reminder, not a greeting.
        Advance(29);
        Assert.Empty(controller.Chat);

        Advance(2);
        Assert.Equal(["thirty seconds in — good luck"], controller.Chat);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// The countdown clears itself from inside its own handler, which is the normal way
    /// an interval ends and the one that has to work.
    /// </summary>
    [Fact]
    public void TheWarmupCountdownStopsItself()
    {
        Assert.True(LoadTimerExample().Succeeded);
        _world.Add(7, "murqin");

        Assert.Equal(1, _host.Dispatch("player_connect_full", new FakePlayerEvent(_table.For(7))));
        Assert.Equal(1, _host.Timers.Count);

        for (var second = 0; second < 8; second++)
        {
            Advance(1);
        }

        // Four announcements, then the restart, then nothing: the interval cleared
        // itself rather than counting past zero into negative numbers.
        Assert.Equal(
            ["say warmup ends in 4", "say warmup ends in 3", "say warmup ends in 2", "say warmup ends in 1", "mp_restartgame 1"],
            _server.Commands);
        Assert.Equal(0, _host.Timers.Count);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// The trap the example exists to show: a player captured in a timer, read three
    /// seconds later, after they have gone. With a cached pointer this is a crash.
    /// </summary>
    [Fact]
    public void ATimerHoldingAPlayerWhoLeftDoesNotFail()
    {
        Assert.True(LoadTimerExample().Succeeded);
        var controller = _world.Add(7, "murqin");

        Assert.Equal(1, _host.Dispatch("player_death", new FakePlayerDeathEvent(_table.For(7), null, false, "ak47")));
        _world.Disconnect(7);

        Advance(4);

        Assert.Empty(controller.Chat);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// Reloading the timer example must not leave the previous version's countdown
    /// running underneath the new one — the promise the declarations make to the author.
    /// </summary>
    [Fact]
    public void ReloadingTheTimerExampleDoesNotDoubleItsInterval()
    {
        Assert.True(LoadTimerExample().Succeeded);
        _world.Add(7, "murqin");
        _host.Dispatch("player_connect_full", new FakePlayerEvent(_table.For(7)));
        Assert.Equal(1, _host.Timers.Count);

        Assert.True(LoadTimerExample().Succeeded);
        Assert.Equal(0, _host.Timers.Count);
    }

    /// <summary>
    /// A host API's array has to arrive as a JavaScript array. Without the conversion a
    /// script gets a host object whose length is Length and which has no map or filter —
    /// a C# API wearing a JavaScript name, which is what the facade exists to avoid.
    /// </summary>
    [Fact]
    public void ArraysFromHostApisBehaveLikeJavaScriptArrays()
    {
        _world.Add(1);
        _world.Add(2);

        var result = _host.Load(
            "arrays",
            "arrays.ts",
            """
            on("round_start", (): void => {
                const all = players.all();
                console.log(`${all.length} ${Array.isArray(all)} ${all.map((p) => p.id).join("+")}`);
            });
            """);

        Assert.True(result.Succeeded, string.Join("; ", result.Report()));
        _host.Dispatch("round_start", 0);

        Assert.Contains("2 true 1+2", _console.Lines);
    }

    /// <summary>
    /// The JavaScript script, through the same host. A .js file has nothing to strip,
    /// so what this really checks is that the runtime treats both extensions alike.
    /// JavaScript is first class here, and a claim like that is only true while
    /// something runs a whole .js file rather than a snippet.
    /// </summary>
    [Fact]
    public void TheJavaScriptSampleLoadsAndHandlesEvents()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "rounds.js");
        var source = File.ReadAllText(path);

        var result = _host.Load("rounds", "rounds.js", source);
        Assert.True(result.Succeeded, string.Join("; ", result.Report()));

        // Nothing was stripped: a .js file comes back byte for byte.
        Assert.Equal(source, _host.Stripper.Strip("rounds.js", source).JavaScript);

        _world.Add(7, "murqin");
        Assert.Equal(1, _host.Dispatch("round_start", new FakeRoundStartEvent(115)));
        Assert.Equal(1, _host.Dispatch("player_connect_full", new FakePlayerEvent(_table.For(7))));
        Assert.Equal(1, _host.DrainFrames());

        Assert.Contains("round 1 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("murqin is still here, 1 connected", _console.Lines);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// The script registers a command, so the command path has to survive everything
    /// else the script does — registration happens at load, and firing happens much
    /// later against whatever state the rest of the script left behind.
    /// </summary>
    [Fact]
    public void TheSampleScriptAnswersItsCommand()
    {
        Assert.True(LoadExample().Succeeded);
        var controller = _world.Add(7, "murqin");

        Assert.Equal(1, _host.DispatchCommand("whereami", _table.For(7), []).Taken);
        Assert.Equal(["1, 2, 3 on de_dust2"], controller.Chat);

        // The same command also flashes a line in the centre of the screen, straight
        // through to the game rather than kept — sendCenter is sendChat's counterpart.
        Assert.Equal(["<font color='#8cf'>de_dust2</font>"], controller.Center);

        // From the server console there is no player, and the example says so rather
        // than throwing — which is the case the null in the signature exists for.
        Assert.Equal(1, _host.DispatchCommand("whereami", null, ["x"]).Taken);
        Assert.Contains("whereami: nobody ran this — args were [x]", _console.Lines);

        controller.Pawn = null;
        Assert.Equal(1, _host.DispatchCommand("whereami", _table.For(7), []).Taken);
        Assert.Contains("you are not in the world right now", controller.Chat);

        Assert.Empty(_errors);
    }

    [Fact]
    public void TheJavaScriptSampleAnswersItsCommand()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "rounds.js");
        Assert.True(_host.Load("rounds", "rounds.js", File.ReadAllText(path)).Succeeded);

        var controller = _world.Add(7, "murqin");

        Assert.Equal(1, _host.DispatchCommand("ping", _table.For(7), ["one"]).Taken);
        Assert.Equal(["pong (1 argument)"], controller.Chat);

        Assert.Equal(1, _host.DispatchCommand("ping", _table.For(7), []).Taken);
        Assert.Contains("pong (0 arguments)", controller.Chat);

        Assert.Empty(_errors);
    }

    /// <summary>
    /// The entity example, run rather than merely compiled: it searches the world, makes
    /// something, puts it somewhere, and takes it away again on a timer.
    /// </summary>
    [Fact]
    public void TheEntityExampleFindsAndMakesThings()
    {
        Assert.True(LoadEntityExample().Succeeded);

        _entities.Spawn(20, "weapon_ak47");
        _entities.Spawn(21, "weapon_ak47");
        _entities.Spawn(22, "planted_c4").Origin = new ScriptVector(700, -200, 64);

        Assert.Equal(1, _host.Dispatch("round_start", new FakeRoundStartEvent(115)));
        Assert.Contains("2 rifle(s) lying around", _console.Lines);
        Assert.Contains("the bomb is down at 700", _console.Lines);

        var controller = _world.Add(7, "murqin");
        controller.Pawn!.Origin = new ScriptVector(10, 20, 30);

        Assert.Equal(1, _host.DispatchCommand("crate", _table.For(7), []).Taken);

        var crate = Assert.Single(_entities.Find("prop_physics_override"));
        Assert.Equal(3, ((FakeEntityRaw)crate.Raw).TeamNum);
        Assert.Equal(62, crate.Position!.Z);
        Assert.Contains($"prop_physics_override {crate.Index} dropped for murqin", _console.Lines);

        // The crate outlives the command that made it and is taken away by a timer that
        // checks first. Nothing here is about the timer; it is about a reference held
        // across ten seconds still meaning what it meant.
        Advance(9);
        Assert.True(crate.IsValid);

        Advance(2);
        Assert.False(crate.IsValid);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// The same script, with the entity gone before the timer fires. This is the case a
    /// cached pointer turns into a crash: the round ended, the game cleaned up, and the
    /// callback is holding a reference to a slot somebody else now owns.
    /// </summary>
    [Fact]
    public void TheEntityExampleSurvivesTheCrateBeingCleanedUpFirst()
    {
        Assert.True(LoadEntityExample().Succeeded);

        var controller = _world.Add(7, "murqin");
        controller.Pawn!.Origin = new ScriptVector(0, 0, 0);
        Assert.Equal(1, _host.DispatchCommand("crate", _table.For(7), []).Taken);

        var crate = Assert.Single(_entities.Find("prop_physics_override"));

        // Read before the entity goes: index answers -1 once it has, which is the point
        // of it not being an identity.
        var slot = crate.Index;
        _entities.Destroy(slot);

        // The slot is taken by something else before the timer runs, which is what makes
        // this different from the entity merely being gone.
        _entities.Spawn(slot, "weapon_deagle");

        Advance(11);

        Assert.False(crate.IsValid);
        Assert.Single(_entities.Find("weapon_deagle"));
        Assert.Empty(_errors);
    }

    /// <summary>
    /// A plugin split across two files, run rather than merely compiled.
    ///
    /// Everything here was impossible an hour ago: the shipped tsconfig accepted the
    /// import and the server answered "Cannot use import statement outside a module".
    /// </summary>
    [Fact]
    public void TheFolderPluginImportsItsOwnModule()
    {
        var result = LoadJetpackExample();
        Assert.True(result.Succeeded, string.Join(" | ", result.Report()));

        var controller = _world.Add(7, "murqin");
        controller.Pawn!.Origin = new ScriptVector(10, 20, 30);

        Assert.Equal(1, _host.DispatchCommand("jetpack", _table.For(7), []).Taken);

        // 30 + 350, computed in physics.ts and applied in index.ts. A number that could
        // only have come from the imported module.
        Assert.Equal(380, controller.Pawn.Origin!.Z);
        Assert.Contains("murqin boosted to 380", _console.Lines);

        // Module state, kept across calls: half a charge left, so the second boost is
        // half as high.
        Assert.Equal(1, _host.DispatchCommand("jetpack", _table.For(7), []).Taken);
        Assert.Equal(555, controller.Pawn.Origin!.Z);

        Assert.Equal(1, _host.DispatchCommand("jetpack", _table.For(7), []).Taken);
        Assert.Contains("jetpack is empty until the next round", controller.Chat);

        Assert.Equal(1, _host.Dispatch("round_start", new FakeRoundStartEvent(115)));
        Assert.Contains("jetpacks refuelled", _console.Lines);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// The centre-text example, run rather than merely compiled: player_spawn flashes a
    /// line straight to the game, and !hud keeps one that a tick re-sends until it is
    /// cleared.
    /// </summary>
    [Fact]
    public void TheHudExampleFlashesOneLineAndKeepsAnother()
    {
        Assert.True(LoadHudExample().Succeeded);
        var controller = _world.Add(7, "murqin");

        Assert.Equal(1, _host.Dispatch("player_spawn", new FakePlayerEvent(_table.For(7))));
        Assert.Equal(["<font color='#8cf'>good luck, murqin</font>"], controller.Center);

        // A kept line does nothing until a tick re-sends it, and then keeps doing so.
        controller.Center.Clear();
        Assert.Equal(1, _host.DispatchCommand("hud", _table.For(7), []).Taken);
        Assert.Equal(1, _host.CenterHud.Count);
        Assert.Empty(controller.Center);

        RefreshHud();
        Assert.Equal(["<font color='#f55'>BOMB DOWN</font>"], controller.Center);

        // Cleared on command, and it stays cleared.
        Assert.Equal(1, _host.DispatchCommand("clearhud", _table.For(7), []).Taken);
        Assert.Equal(0, _host.CenterHud.Count);

        controller.Center.Clear();
        RefreshHud();
        Assert.Empty(controller.Center);
        Assert.Empty(_errors);
    }

    /// <summary>
    /// Reloading the script takes its kept centre messages with it, the same promise the
    /// timer example makes about its interval.
    /// </summary>
    [Fact]
    public void ReloadingTheHudExampleClearsItsKeptMessages()
    {
        Assert.True(LoadHudExample().Succeeded);
        _world.Add(7, "murqin");

        Assert.Equal(1, _host.DispatchCommand("hud", _table.For(7), []).Taken);
        Assert.Equal(1, _host.CenterHud.Count);

        Assert.True(LoadHudExample().Succeeded);
        Assert.Equal(0, _host.CenterHud.Count);
    }

    [Fact]
    public void TheDeferredCallbackRunsWhenThePlayerIsStillThere()
    {
        Assert.True(LoadExample().Succeeded);
        _world.Add(7, "murqin", 76561198123456789UL);

        _host.Dispatch("player_connect_full", new FakePlayerEvent(_table.For(7)));

        Assert.Equal(1, _host.DrainFrames());
        Assert.Contains("murqin (76561198123456789) is still here on the next frame", _console.Lines);
    }
}
