namespace Cs2Ts.Server.Tests;

/// <summary>
/// What only a running game can answer.
///
/// The rest of the suite tests Cs2Ts.Runtime against a fake game, and the fake is
/// written to the same contract the CounterStrikeSharp binding claims to implement. So
/// when the binding is the thing that is wrong, everything stays green: that is exactly
/// how isValid shipped reporting true for a player who had left. These tests exist to
/// make the binding layer capable of failing.
///
/// One server is started for the whole class. Booting takes tens of seconds, and none
/// of these tests need a fresh one — they ask questions rather than break things.
/// </summary>
[Collection("dedicated server")]
public sealed class BindingTests(ServerFixture fixture)
{
    private static readonly TimeSpan Answer = TimeSpan.FromSeconds(20);

    [Fact]
    public async Task TheScriptsTheSuiteChoseAreTheOnesThatLoaded()
    {
        var server = fixture.Require();

        // The point of CS2TS_SCRIPTS: whatever an operator left in the plugin's own
        // scripts folder must not be able to decide whether these tests pass.
        var loaded = await server.WaitForAsync(
            line => line.Contains("[CS2-TS] loaded harness.ts", StringComparison.Ordinal), Answer);

        Assert.Contains("harness.ts", loaded, StringComparison.Ordinal);
        Assert.DoesNotContain(server.Transcript,
            line => line.Contains("[CS2-TS] loaded welcome.ts", StringComparison.Ordinal));
    }

    [Fact]
    public async Task TheScriptRunsOnTheEngineThePluginShips()
    {
        var server = fixture.Require();

        // Not a formality. Both V8s are in this process, and if ClearScript's calls bind
        // to the game's own copy the isolation everything here assumes is simply absent —
        // with no other symptom.
        Assert.DoesNotContain(server.Transcript,
            line => line.Contains("the scripting engine is not the one this plugin ships", StringComparison.Ordinal));

        server.Command("cs2ts_status");
        var engine = await server.WaitForAsync(
            line => line.Contains("[CS2-TS] engine:", StringComparison.Ordinal), Answer);

        Assert.Contains("the one this plugin ships", engine, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ACommandFromTheConsoleReachesTheScript()
    {
        var server = fixture.Require();

        server.Command("css_hping");

        await server.WaitForAsync(line => line.Contains("HARNESS pong", StringComparison.Ordinal), Answer);
    }

    [Fact]
    public async Task ATimerFiresOnARealTick()
    {
        var server = fixture.Require();

        // A timer is checked once per game tick, so this fails if the server has
        // hibernated — which an empty one does by default, and which looks exactly like
        // a broken timer table rather than a stopped loop.
        server.Command("css_htimer");

        await server.WaitForAsync(line => line.Contains("HARNESS timer fired", StringComparison.Ordinal), Answer);
    }

    [Fact]
    public async Task TheEscapeHatchWritesASchemaFieldTheFacadeThenReads()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hunsafe");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS unsafe ", StringComparison.Ordinal), Answer);

        // Two routes to one field: unsafe marshals it in host code, the facade goes
        // through CounterStrikeSharp's own property. They have to agree, or one of them
        // is reading somewhere else.
        Assert.Contains("host=37 facade=37", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ASchemaNameTheGameDoesNotHaveIsRefused()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hbadname");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS badname ", StringComparison.Ordinal), Answer);

        // Unrefused, this write would land at offset zero — the vtable pointer on these
        // objects. Nothing would be logged and the crash would arrive later, somewhere
        // else. There is no unit test for this: the lookup is CounterStrikeSharp's.
        Assert.Contains("refused", line, StringComparison.Ordinal);
        Assert.Contains("has no field called 'm_iHealth'", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AHandleStopsResolvingWhenThePlayerLeaves()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hhold");
        var held = await server.WaitForAsync(
            line => line.Contains("HARNESS hold id=", StringComparison.Ordinal), Answer);
        Assert.DoesNotContain("id=-1", held, StringComparison.Ordinal);

        server.Command("css_hheld");
        var before = await server.WaitForAsync(
            line => line.Contains("HARNESS held valid=", StringComparison.Ordinal), Answer);
        Assert.Contains("valid=true", before, StringComparison.Ordinal);

        // The situation no fake reproduces: the controller stays valid and keeps the
        // departed player's name for a while, which is what made isValid lie.
        server.ClearTranscript();
        server.Command("bot_kick");
        await Task.Delay(TimeSpan.FromSeconds(3));

        server.Command("css_hheld");
        var after = await server.WaitForAsync(
            line => line.Contains("HARNESS held valid=", StringComparison.Ordinal), Answer);

        Assert.Contains("valid=false", after, StringComparison.Ordinal);
        Assert.Contains("is no longer in the game", after, StringComparison.Ordinal);
    }
}
