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
    /// <summary>Stands in for a CounterStrikeSharp controller.</summary>
    public sealed class FakePlayer
    {
        public bool Connected { get; set; } = true;
    }

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
    public sealed class FakePlayers(EntityHandleTable<FakePlayer> table, Func<int> count)
    {
        [ScriptMember("byUserId")]
        public EntityHandle<FakePlayer> ByUserId(int userId) => table.For(userId);

        [ScriptMember("all")]
        public EntityHandle<FakePlayer>[] All() =>
            Enumerable.Range(1, count()).Select(id => table.For(id)).ToArray();
    }

    private readonly Dictionary<long, FakePlayer> _world = [];
    private readonly EntityHandleTable<FakePlayer> _table;
    private readonly FakeConsole _console = new();
    private readonly List<ScriptError> _errors = [];
    private readonly ScriptHost _host;

    public ExampleScriptTests()
    {
        _table = new EntityHandleTable<FakePlayer>(
            "player",
            id => _world.TryGetValue(id, out var player) && player.Connected ? player : null);

        _host = new ScriptHost(_errors.Add);
        _host.Configure = (plugin, engine) =>
        {
            engine.AddHostObject("console", _console);
            engine.AddHostObject("server", new FakeServer(plugin, _host!.Frames));
            engine.AddHostObject("players", new FakePlayers(_table, () => _world.Count(e => e.Value.Connected)));
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

        _world[7] = new FakePlayer();

        Assert.Equal(1, _host.Dispatch("round_start", 115));
        Assert.Equal(1, _host.Dispatch("round_start", 115));
        Assert.Equal(1, _host.Dispatch("player_connect", _table.For(7)));
        Assert.Equal(1, _host.Dispatch("player_death", _table.For(7)));

        Assert.Contains("round 1 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("round 2 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("player 7 connected", _console.Lines);
        Assert.Contains("player 7 died; 1 still connected", _console.Lines);
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
        _world[7] = new FakePlayer();

        _host.Dispatch("player_connect", _table.For(7));
        _world[7].Connected = false;

        Assert.Equal(1, _host.DrainFrames());

        Assert.Contains("player 7 connected", _console.Lines);
        Assert.DoesNotContain("player 7 is still here on the next frame", _console.Lines);
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
        _world[1] = new FakePlayer();
        _world[2] = new FakePlayer();

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

        _world[7] = new FakePlayer();
        Assert.Equal(1, _host.Dispatch("round_start", 115));
        Assert.Equal(1, _host.Dispatch("player_connect", _table.For(7)));
        Assert.Equal(1, _host.DrainFrames());

        Assert.Contains("round 1 started, 115s limit, on de_dust2", _console.Lines);
        Assert.Contains("player 7 is still here, 1 connected", _console.Lines);
        Assert.Empty(_errors);
    }

    [Fact]
    public void TheDeferredCallbackRunsWhenThePlayerIsStillThere()
    {
        Assert.True(LoadExample().Succeeded);
        _world[7] = new FakePlayer();

        _host.Dispatch("player_connect", _table.For(7));

        Assert.Equal(1, _host.DrainFrames());
        Assert.Contains("player 7 is still here on the next frame", _console.Lines);
    }
}
