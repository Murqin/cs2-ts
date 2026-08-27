using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// Runs the example that ships with the project, end to end: stripped, loaded, and
/// dispatched to. The example is the first thing anyone reads, and the cost of it being
/// subtly wrong is paid by every new author, so it is a test rather than a document.
///
/// The host API is faked here because the real one lives in the CounterStrikeSharp
/// binding, which needs a server. What is not faked is the shape: if the example starts
/// using something the binding does not install, this stops compiling or stops running.
/// </summary>
public sealed class ExampleScriptTests : IDisposable
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

    private readonly FakeWorld _world = new();
    private readonly PlayerFacadeTable<FakeController, FakePawn> _table;
    private readonly FakeConsole _console = new();
    private readonly List<ScriptError> _errors = [];
    private readonly ScriptHost _host;

    public ExampleScriptTests()
    {
        _table = new PlayerFacadeTable<FakeController, FakePawn>(
            "player", _world.Resolve, new FakeOperations(_world));

        _host = new ScriptHost(_errors.Add);
        _host.Configure = (plugin, engine) =>
        {
            engine.AddHostObject("console", _console);
            engine.AddHostObject("server", new FakeServer(plugin, _host!.Frames));
            engine.AddHostObject("players", new FakePlayers(_table, _world));
        };
    }

    public void Dispose() => _host.Dispose();

    private PluginLoadResult LoadExample()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "welcome.ts");
        return _host.Load("welcome", "welcome.ts", File.ReadAllText(path));
    }

    [Fact]
    public void TheShippedExampleLoadsAndHandlesEvents()
    {
        var result = LoadExample();
        Assert.True(result.Succeeded, string.Join("; ", result.Report()));

        var controller = _world.Add(7, "murqin");
        controller.Pawn!.Health = 3;
        controller.Pawn.Armor = 0;

        Assert.Equal(1, _host.Dispatch("round_start", 115));
        Assert.Equal(1, _host.Dispatch("round_start", 115));
        Assert.Equal(1, _host.Dispatch("player_connect", _table.For(7)));
        Assert.Equal(1, _host.Dispatch("player_spawn", _table.For(7)));
        Assert.Equal(1, _host.Dispatch("player_death", _table.For(7)));

        Assert.Contains("round 1 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("round 2 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("murqin spawned at 1, 2, 3 with $800", _console.Lines);
        Assert.Contains("murqin died; 1 still connected", _console.Lines);
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

        _host.Dispatch("player_connect", _table.For(7));
        _world.Disconnect(7);

        Assert.Equal(1, _host.DrainFrames());

        Assert.Equal(["welcome, murqin"], controller.Chat);
        Assert.DoesNotContain(_console.Lines, line => line.Contains("still here on the next frame"));
        Assert.Empty(_errors);
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
    /// The JavaScript example, through the same host. A .js file has nothing to strip,
    /// so what this really checks is that the runtime treats both extensions alike —
    /// and that the example a JavaScript author reads first actually runs.
    /// </summary>
    [Fact]
    public void TheShippedJavaScriptExampleLoadsAndHandlesEvents()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "rounds.js");
        var source = File.ReadAllText(path);

        var result = _host.Load("rounds", "rounds.js", source);
        Assert.True(result.Succeeded, string.Join("; ", result.Report()));

        // Nothing was stripped: a .js file comes back byte for byte.
        Assert.Equal(source, _host.Stripper.Strip("rounds.js", source).JavaScript);

        _world.Add(7, "murqin");
        Assert.Equal(1, _host.Dispatch("round_start", 115));
        Assert.Equal(1, _host.Dispatch("player_connect", _table.For(7)));
        Assert.Equal(1, _host.DrainFrames());

        Assert.Contains("round 1 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("murqin is still here, 1 connected", _console.Lines);
        Assert.Empty(_errors);
    }

    [Fact]
    public void TheDeferredCallbackRunsWhenThePlayerIsStillThere()
    {
        Assert.True(LoadExample().Succeeded);
        _world.Add(7, "murqin", 76561198123456789UL);

        _host.Dispatch("player_connect", _table.For(7));

        Assert.Equal(1, _host.DrainFrames());
        Assert.Contains("murqin (76561198123456789) is still here on the next frame", _console.Lines);
    }
}
