using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>Collects values a script hands back, so a test can see what actually ran.</summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class Sink
{
    public List<int> Values { get; } = [];

    [ScriptMember("record")]
    public void Record(int value) => Values.Add(value);
}

/// <summary>
/// One host for the class. Building a host evaluates the TypeScript parser, which is
/// the one slow thing in this layer, and these tests do not need a fresh one each time.
/// </summary>
public sealed class HostFixture : IDisposable
{
    public HostFixture()
    {
        Host = new ScriptHost(Errors.Add, new ScriptHostOptions(Budget: TimeSpan.FromSeconds(2)));

        // The same seam the CounterStrikeSharp binding uses to install its host API.
        Host.Configure = (_, engine) => engine.AddHostObject("sink", Sink);
    }

    public ScriptHost Host { get; }

    public List<ScriptError> Errors { get; } = [];

    public Sink Sink { get; } = new();

    public void Dispose() => Host.Dispose();
}

[CollectionDefinition(Name)]
public sealed class HostCollection : ICollectionFixture<HostFixture>
{
    public const string Name = "host";
}

[Collection(HostCollection.Name)]
public sealed class ScriptHostTests(HostFixture fixture) : IDisposable
{
    private ScriptHost Host => fixture.Host;

    private List<ScriptError> Errors => fixture.Errors;

    private List<int> Recorded => fixture.Sink.Values;

    /// <summary>Each test starts with nothing loaded and nothing recorded.</summary>
    public void Dispose()
    {
        foreach (var name in Host.Loaded)
        {
            Host.Unload(name);
        }

        Errors.Clear();
        Recorded.Clear();
    }

    private PluginLoadResult Load(string name, string typeScript) =>
        Host.Load(name, $"{name}.ts", typeScript);

    /// <summary>
    /// The engine check has to say yes for a healthy engine, or it is a check that
    /// would never fire.
    ///
    /// Outside the CS2 process there is only one V8, so this cannot prove the check
    /// discriminates — that was done on a server, by reading the same features from a
    /// script and finding all of them present on an engine three years newer than the
    /// game's. What this pins is that a working engine is not reported as broken.
    /// </summary>
    [Fact]
    public void TheEngineCheckPassesOnAHealthyEngine()
    {
        using var runtime = new Microsoft.ClearScript.V8.V8Runtime("engine-check");
        using var engine = runtime.CreateScriptEngine("engine-check");

        Assert.True(V8Bootstrap.LooksLikeOurV8(engine));
    }

    /// <summary>
    /// A reload must not cost the author their file and line.
    ///
    /// It did, and only on a server: every plugin engine shares one V8Runtime, so the
    /// second load of "x.ts" met a document of that name already in ClearScript's store
    /// and was renamed "x [2].ts". Every stack frame then pointed at a file nobody has,
    /// and the location was dropped — leaving "error in plugin 'x'" with nowhere to
    /// look. Tests that load once cannot see it, which is why this one loads twice.
    /// </summary>
    [Fact]
    public void ReloadingKeepsTheAuthorsFileAndLine()
    {
        const string Source =
            """
            on("boom", (): void => {
                throw new Error("from the script");
            });
            """;

        for (var load = 1; load <= 3; load++)
        {
            Assert.True(Host.Load("located", "located.ts", Source).Succeeded);
            Host.Dispatch("boom");

            var error = Assert.Single(Errors);
            Assert.Equal("located.ts", error.FileName);
            Assert.Equal(2, error.Line);
            Assert.StartsWith("located.ts(2,", error.ToString());
            Errors.Clear();
        }
    }

    /// <summary>
    /// A file name with a space in it is a name someone will use, and it used to take
    /// the location with it: the frame pattern excluded whitespace.
    /// </summary>
    [Fact]
    public void AFileNameWithASpaceKeepsItsLocation()
    {
        Assert.True(Host.Load(
            "spaced",
            "vip system.ts",
            """
            on("boom", (): void => {
                throw new Error("from the script");
            });
            """).Succeeded);

        Host.Dispatch("boom");

        var error = Assert.Single(Errors);
        Assert.Equal("vip system.ts", error.FileName);
        Assert.Equal(2, error.Line);
    }

    [Fact]
    public void LoadsATypeScriptPluginAndDispatchesToIt()
    {
        var result = Load(
            "warmup",
            """
            let seen: number = 0;

            on("round_start", (round: number): void => {
                seen = seen + round;
            });

            on("report", (): void => {
                sink.record(seen);
            });
            """);

        Assert.True(result.Succeeded, string.Join("; ", result.Report()));

        Assert.Equal(1, Host.Dispatch("round_start", 5));
        Assert.Equal(1, Host.Dispatch("round_start", 3));
        Host.Dispatch("report");

        Assert.Equal([8], Recorded);
        Assert.Empty(Errors);
    }

    [Fact]
    public void RefusesAPluginWhoseTypeScriptCannotBeStripped()
    {
        var result = Load("bad", "enum Team { T, CT }\non('x', () => {});\n");

        Assert.False(result.Succeeded);
        Assert.Empty(Host.Loaded);
        var diagnostic = Assert.Single(result.Diagnostics);
        Assert.Equal("CS2TS_ENUM", diagnostic.Code);
        Assert.StartsWith("bad.ts(1,1): error CS2TS_ENUM:", diagnostic.ToString());
    }

    /// <summary>
    /// A plugin whose top level throws never loaded, so nothing is left registered, and
    /// the failure names the author's own line.
    /// </summary>
    [Fact]
    public void ReportsAPluginWhoseTopLevelThrowsAndLeavesNothingLoaded()
    {
        var result = Load(
            "broken",
            """
            on("round_start", (): void => {});
            throw new Error("missing config");
            """);

        Assert.False(result.Succeeded);
        Assert.Empty(Host.Loaded);
        Assert.Equal(0, Host.Dispatch("round_start"));

        Assert.Equal("Error: missing config", result.Error!.Message);
        Assert.Equal("broken.ts", result.Error.FileName);
        Assert.Equal(2, result.Error.Line);
    }

    [Fact]
    public void DispatchesToEveryPluginThatRegisteredForAnEvent()
    {
        Load("a", "on('tick', () => {});");
        Load("b", "on('tick', () => {});\non('tick', () => {});");
        Load("c", "on('other', () => {});");

        Assert.Equal(3, Host.Dispatch("tick"));
        Assert.Equal(1, Host.Dispatch("other"));
        Assert.Equal(0, Host.Dispatch("unregistered"));
    }

    /// <summary>
    /// A throw in one plugin's handler must not stop the next plugin's, and must not
    /// reach the caller — which is a CounterStrikeSharp event running under native code.
    /// </summary>
    [Fact]
    public void OneFailingHandlerDoesNotStopTheOthers()
    {
        Load("good", "on('tick', () => { sink.record(1); });");
        Load("bad", "on('tick', () => { throw new Error('boom'); });");
        Load("alsoGood", "on('tick', () => { sink.record(3); });");

        Assert.Equal(2, Host.Dispatch("tick"));
        Assert.Equal([1, 3], Recorded);

        var error = Assert.Single(Errors);
        Assert.Equal("bad", error.PluginName);
        Assert.Equal("bad.ts", error.FileName);
    }

    [Fact]
    public void PluginsCannotSeeEachOthersGlobals()
    {
        Load("a", "globalThis.secret = 'a';\non('tick', () => {});");
        Load("b", "on('tick', () => { sink.record(typeof globalThis.secret === 'undefined' ? 0 : 1); });");

        Host.Dispatch("tick");

        Assert.Equal([0], Recorded);
    }

    // ---- reloading, which is where the design's failure list lives ----

    /// <summary>
    /// V8 cannot unload a module, so replacing a plugin means replacing its context. If
    /// the old context survived, its handler would keep running next to the new one —
    /// "duplicate event handlers" by another name.
    /// </summary>
    [Fact]
    public void ReloadReplacesHandlersRatherThanAddingToThem()
    {
        Load("vip", "on('tick', () => { sink.record(1); });");
        Host.Dispatch("tick");

        Load("vip", "on('tick', () => { sink.record(2); });");
        Host.Dispatch("tick");

        Assert.Equal([1, 2], Recorded);
        Assert.Single(Host.Loaded);
    }

    /// <summary>State from the previous version must not survive into the new one.</summary>
    [Fact]
    public void ReloadStartsFromAnEmptyContext()
    {
        Load("counter", "globalThis.leftBehind = 41;\non('tick', () => {});");
        Load("counter", "on('tick', () => { sink.record(typeof globalThis.leftBehind === 'undefined' ? 0 : 1); });");

        Host.Dispatch("tick");

        Assert.Equal([0], Recorded);
    }

    [Fact]
    public void UnloadStopsDispatchAndCancelsTheLifetime()
    {
        var plugin = Load("vip", "on('tick', () => {});").Plugin!;

        Assert.False(plugin.Lifetime.IsCancellationRequested);
        Assert.True(Host.Unload("vip"));

        Assert.True(plugin.Lifetime.IsCancellationRequested);
        Assert.Equal(0, Host.Dispatch("tick"));
        Assert.Empty(Host.Loaded);
        Assert.False(Host.Unload("vip"));
    }

    // ---- the frame queue: background work coming back to the game thread ----

    [Fact]
    public void RunsQueuedWorkOnTheDrainingThread()
    {
        var plugin = Load("vip", "on('tick', () => {});").Plugin!;
        var ran = 0;

        Host.Frames.Post(plugin, "http-reply", () => { ran++; return null; });
        Host.Frames.Post(plugin, "http-reply", () => { ran++; return null; });

        Assert.Equal(0, ran);
        Assert.Equal(2, Host.DrainFrames());
        Assert.Equal(2, ran);
        Assert.Equal(0, Host.DrainFrames());
    }

    /// <summary>
    /// The rule the design states outright: a reply that started three seconds ago must
    /// not run against a plugin that has since been unloaded.
    /// </summary>
    [Fact]
    public void DropsQueuedWorkBelongingToAnUnloadedPlugin()
    {
        var plugin = Load("vip", "on('tick', () => {});").Plugin!;
        var ran = false;
        var droppedBefore = Host.Frames.Dropped;

        Host.Frames.Post(plugin, "http-reply", () => { ran = true; return null; });
        Host.Unload("vip");

        Assert.Equal(0, Host.DrainFrames());
        Assert.False(ran);
        Assert.True(Host.Frames.Dropped > droppedBefore);
    }

    /// <summary>
    /// A callback that queues another one must not keep the drain running, which would
    /// be a hang assembled out of well-behaved parts.
    /// </summary>
    [Fact]
    public void DrainRunsOnlyWhatWasQueuedWhenItStarted()
    {
        var plugin = Load("vip", "on('tick', () => {});").Plugin!;
        var ran = 0;

        void Requeue() => Host.Frames.Post(plugin, "loop", () => { ran++; Requeue(); return null; });

        Requeue();

        Assert.Equal(1, Host.DrainFrames());
        Assert.Equal(1, ran);
        Assert.Equal(1, Host.Frames.Count);

        Host.Unload("vip");
        Host.DrainFrames();
    }

    [Fact]
    public void ContainsAFailureInQueuedWork()
    {
        var plugin = Load("vip", "on('tick', () => {});").Plugin!;

        Host.Frames.Post(plugin, "http-reply", () => throw new InvalidOperationException("socket closed"));

        Assert.Equal(0, Host.DrainFrames());
        var error = Assert.Single(Errors);
        Assert.Equal(ScriptErrorSource.Host, error.Source);
        Assert.Equal("vip", error.PluginName);
    }

    [Fact]
    public void RefusesABadRegistrationWithAMessageTheAuthorCanActOn()
    {
        var result = Load("bad", "on(123, () => {});");

        Assert.False(result.Succeeded);
        Assert.Contains("event name must be a non-empty string", result.Error!.Message);
    }
}

/// <summary>
/// The watchdog needs its own hosts: the budget is fixed when a host is built, and a
/// budget short enough to test is too short to share with everything else.
/// </summary>
public sealed class ScriptWatchdogTests
{
    private static ScriptHost Build(List<ScriptError> errors, int budgetMs = 150) =>
        new(errors.Add, new ScriptHostOptions(Budget: TimeSpan.FromMilliseconds(budgetMs)));

    /// <summary>
    /// Inline execution means a runaway handler stops the game loop. Interrupt is the
    /// one escape V8 gives an embedder that a native plugin does not have.
    /// </summary>
    [Fact]
    public void InterruptsAHandlerThatNeverReturns()
    {
        var errors = new List<ScriptError>();
        using var host = Build(errors);
        host.Load("runaway", "runaway.ts", "on('tick', () => { while (true) {} });");

        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        Assert.Equal(0, host.Dispatch("tick"));
        var elapsed = System.Diagnostics.Stopwatch.GetElapsedTime(started);

        Assert.True(elapsed < TimeSpan.FromSeconds(5), $"the interrupt took {elapsed.TotalSeconds:F1}s");
        var error = Assert.Single(errors);
        Assert.Equal(ScriptErrorSource.Interrupted, error.Source);
        Assert.Equal("runaway", error.PluginName);
        Assert.Equal(1, host.Watchdog.Interruptions);
    }

    /// <summary>
    /// An interrupted engine has to keep working, or the watchdog has traded a hang for
    /// a dead plugin.
    /// </summary>
    [Fact]
    public void KeepsThePluginUsableAfterAnInterrupt()
    {
        var errors = new List<ScriptError>();
        var sink = new Sink();
        using var host = Build(errors);
        host.Configure = (_, engine) => engine.AddHostObject("sink", sink);

        host.Load(
            "mixed",
            "mixed.ts",
            """
            on("spin", () => { while (true) {} });
            on("work", () => { sink.record(7); });
            """);

        host.Dispatch("spin");

        Assert.Equal(1, host.Dispatch("work"));
        Assert.Equal([7], sink.Values);
    }

    /// <summary>
    /// The timer is armed only while a call is in flight. If it stayed armed, the call
    /// after a slow one would inherit whatever was left of its budget.
    /// </summary>
    [Fact]
    public void DoesNotInterruptHandlersThatFinishInTime()
    {
        var errors = new List<ScriptError>();
        using var host = Build(errors, budgetMs: 500);
        host.Load("quick", "quick.ts", "on('tick', () => { let n = 0; for (let i = 0; i < 1000; i++) n += i; });");

        for (var i = 0; i < 200; i++)
        {
            Assert.Equal(1, host.Dispatch("tick"));
        }

        Assert.Equal(0, host.Watchdog.Interruptions);
        Assert.Empty(errors);
    }

    /// <summary>A plugin that hangs at load must not hang the server either.</summary>
    [Fact]
    public void InterruptsAPluginThatHangsWhileLoading()
    {
        var errors = new List<ScriptError>();
        using var host = Build(errors);

        var result = host.Load("hangs", "hangs.ts", "while (true) {}");

        Assert.False(result.Succeeded);
        Assert.Equal(ScriptErrorSource.Interrupted, result.Error!.Source);
        Assert.Empty(host.Loaded);
    }
}
