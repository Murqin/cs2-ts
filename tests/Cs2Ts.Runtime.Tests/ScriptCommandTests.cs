using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// One host for the class, and a distinct command name per test.
///
/// A host announces a command name once for its whole life, so tests that shared a name
/// would depend on which ran first. Distinct names keep that property visible instead of
/// working around it with a reset nothing in production would call.
/// </summary>
public sealed class CommandHostFixture : IDisposable
{
    public CommandHostFixture()
    {
        Host = new ScriptHost(Errors.Add, new ScriptHostOptions(Budget: TimeSpan.FromSeconds(2)));
        Host.CommandRegistered = Announced.Add;
        Host.Configure = (_, engine) =>
        {
            engine.AddHostObject("sink", Sink);
            engine.AddHostObject("record", new Action<string>(Recorded.Add));
        };
    }

    public ScriptHost Host { get; }

    public List<ScriptError> Errors { get; } = [];

    /// <summary>Every name the host asked the binding to register, in order.</summary>
    public List<string> Announced { get; } = [];

    public Sink Sink { get; } = new();

    /// <summary>Strings a script handed back, for tests that care about arguments.</summary>
    public List<string> Recorded { get; } = [];

    public void Dispose() => Host.Dispose();
}

[CollectionDefinition(Name)]
public sealed class CommandHostCollection : ICollectionFixture<CommandHostFixture>
{
    public const string Name = "command-host";
}

[Collection(CommandHostCollection.Name)]
public sealed class ScriptCommandTests(CommandHostFixture fixture) : IDisposable
{
    private ScriptHost Host => fixture.Host;

    private List<ScriptError> Errors => fixture.Errors;

    public void Dispose()
    {
        foreach (var name in Host.Loaded)
        {
            Host.Unload(name);
        }

        Errors.Clear();
        fixture.Sink.Values.Clear();
        fixture.Recorded.Clear();
    }

    private PluginLoadResult Load(string name, string source) => Host.Load(name, $"{name}.ts", source);

    [Fact]
    public void ACommandRunsAndSeesItsCaller()
    {
        var caller = new object();

        var result = Load(
            "greet",
            """
            command("!greet", (player, args): void => {
                record(`${player === null ? "console" : "player"} [${args.join("|")}]`);
            });
            """);

        Assert.True(result.Succeeded, string.Join("; ", result.Report()));
        Assert.Equal(1, Host.DispatchCommand("greet", caller, ["a", "b"]).Taken);
        Assert.Equal(1, Host.DispatchCommand("greet", null, []).Taken);

        Assert.Equal(["player [a|b]", "console []"], fixture.Recorded);
        Assert.Empty(Errors);
    }

    [Fact]
    public void HowTheNameIsWrittenDoesNotChangeTheCommand()
    {
        Assert.True(Load("spelling", """command("/spelling_test", (): void => sink.record(1));""").Succeeded);

        // The script wrote a slash; the server knows it by the bare name either way.
        Assert.Equal(1, Host.DispatchCommand("spelling_test", null, []).Taken);
        Assert.Contains("spelling_test", fixture.Announced);
    }

    [Fact]
    public void TheNameIsAnnouncedOnceHoweverOftenItIsRegistered()
    {
        Assert.True(Load("once", """command("!once_only", (): void => sink.record(1));""").Succeeded);
        Assert.True(Load("once", """command("!once_only", (): void => sink.record(2));""").Succeeded);
        Assert.True(Load("once_again", """command("!once_only", (): void => sink.record(3));""").Succeeded);

        // A server command registered twice answers twice, so the second reload must not
        // reach the binding again.
        Assert.Single(fixture.Announced, name => name == "once_only");
    }

    [Fact]
    public void ReloadingReplacesTheHandlerRatherThanAddingOne()
    {
        Assert.True(Load("reload", """command("!reload_test", (): void => sink.record(1));""").Succeeded);
        Assert.Equal(1, Host.DispatchCommand("reload_test", null, []).Taken);

        Assert.True(Load("reload", """command("!reload_test", (): void => sink.record(2));""").Succeeded);
        Assert.Equal(1, Host.DispatchCommand("reload_test", null, []).Taken);

        // The old handler is gone with its context, not running alongside the new one.
        Assert.Equal([1, 2], fixture.Sink.Values);
    }

    [Fact]
    public void TwoScriptsMayAnswerTheSameCommand()
    {
        Assert.True(Load("first", """command("!shared", (): void => sink.record(1));""").Succeeded);
        Assert.True(Load("second", """command("!shared", (): void => sink.record(2));""").Succeeded);

        Assert.Equal(2, Host.DispatchCommand("shared", null, []).Taken);
        Assert.Equal([1, 2], fixture.Sink.Values.Order().ToList());
    }

    [Fact]
    public void UnloadingTakesTheCommandOutOfService()
    {
        Assert.True(Load("gone", """command("!gone_test", (): void => sink.record(1));""").Succeeded);
        Assert.Equal(1, Host.DispatchCommand("gone_test", null, []).Taken);

        Host.Unload("gone");

        // Zero is the answer the binding turns into "no script is handling this",
        // which is the whole reason it is a count rather than void.
        Assert.Equal(0, Host.DispatchCommand("gone_test", null, []).Taken);
    }

    [Fact]
    public void NobodyAnsweringIsNotAnError()
    {
        var outcome = Host.DispatchCommand("never_registered", null, []);

        Assert.True(outcome.Unhandled);
        Assert.Empty(Errors);
    }

    [Fact]
    public void AHandlerSwitchedOffByFloodProtectionIsNotTheSameAsNoHandler()
    {
        // Its own message on the binding's side: a command that exists and has been
        // taken out of service is a different thing to tell an operator than one
        // nobody registered, and the fix for each is different.
        var host = new ScriptHost(_ => { }, new ScriptHostOptions(Policy: new BoundaryPolicy(2, TimeSpan.FromMinutes(1))));
        try
        {
            Assert.True(host.Load(
                "flood",
                "flood.ts",
                """command("!flood_test", (): void => { throw new Error("again"); });""").Succeeded);

            for (var i = 0; i < 3; i++)
            {
                host.DispatchCommand("flood_test", null, []);
            }

            var outcome = host.DispatchCommand("flood_test", null, []);
            Assert.Equal(0, outcome.Taken);
            Assert.Equal(1, outcome.Skipped);
            Assert.False(outcome.Unhandled);
        }
        finally
        {
            host.Dispose();
        }
    }

    [Fact]
    public void ABadNameStopsTheScriptFromLoading()
    {
        var result = Load("bad", """command("two words", (): void => {});""");

        // Not a warning: a command that exists and never fires is worse than a script
        // that refuses to load and says why.
        Assert.False(result.Succeeded);
        Assert.Contains("two words", string.Join(" ", result.Report()));
        Assert.Empty(Host.Loaded);
    }

    [Fact]
    public void RegisteringSomethingThatIsNotAFunctionSaysSo()
    {
        var result = Load("nofunc", """command("!nofunc_test", 42 as unknown as () => void);""");

        Assert.False(result.Succeeded);
        Assert.Contains("must be a function", string.Join(" ", result.Report()));
    }

    [Fact]
    public void AThrowingCommandIsContainedAndAttributed()
    {
        Assert.True(Load(
            "boom",
            """
            command("!boom_test", (): void => {
                throw new Error("command went wrong");
            });
            """).Succeeded);

        // It ran; it just failed. Taken counts handlers that took the call, so the
        // binding can tell "nobody registered this" apart from "it threw" — measured on
        // a server, where a throwing command reported itself as unregistered.
        var outcome = Host.DispatchCommand("boom_test", null, []);
        Assert.Equal(1, outcome.Taken);
        Assert.Equal(1, outcome.Failed);
        Assert.Equal(0, outcome.Completed);
        Assert.False(outcome.Unhandled);

        var error = Assert.Single(Errors);
        Assert.Equal("boom", error.PluginName);
        Assert.Contains("command went wrong", error.Message);
        Assert.Equal("boom.ts", error.FileName);
    }

    [Fact]
    public void ACommandIsNotAnEvent()
    {
        Assert.True(Load(
            "separate",
            """
            command("!separate_test", (): void => sink.record(1));
            on("separate_test", (): void => sink.record(2));
            """).Succeeded);

        Assert.Equal(1, Host.DispatchCommand("separate_test", null, []).Taken);
        Assert.Equal(1, Host.Dispatch("separate_test"));

        // Commands share the handler table with events so that unloading and the
        // watchdog cover both, and the key keeps them from colliding.
        Assert.Equal([1, 2], fixture.Sink.Values);
    }

    [Fact]
    public void TheScriptCanSeeWhatItRegistered()
    {
        Assert.True(Load(
            "listing",
            """
            command("!listing_a", (): void => {});
            command("/listing_b", (): void => {});
            """).Succeeded);

        var plugin = Host.Find("listing");
        Assert.NotNull(plugin);
        Assert.Equal(["listing_a", "listing_b"], plugin.Commands.Order().ToList());
        Assert.Contains("listing_a", Host.KnownCommands);
    }
}
