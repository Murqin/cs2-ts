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
    public async Task ATickHandlerRunsOncePerGameTick()
    {
        var server = fixture.Require();

        var first = await TickCountAsync(server);
        await Task.Delay(TimeSpan.FromSeconds(2));
        var second = await TickCountAsync(server);

        // The claim is a rate, not that the handler ran at all — a handler called once
        // and a handler called on every tick both pass "greater than zero", and the
        // difference between them is the whole feature. This server runs at 64 tick;
        // the range is wide enough for a busy machine and narrow enough that a handler
        // driven by anything other than the game loop fails it.
        var perSecond = (second - first) / 2.0;
        Assert.InRange(perSecond, 30, 130);
    }

    [Fact]
    public async Task ATickHandlerThatKeepsThrowingIsTakenOutOfService()
    {
        var server = fixture.Require();

        server.ClearTranscript();
        server.Command("css_hfailtick");

        // Five failures in ten seconds is the policy, and at 64 tick that is reached in
        // under a tenth of a second. Nothing here is waiting for a slow burn.
        var disabled = await server.WaitForAsync(
            line => line.Contains("has been disabled", StringComparison.Ordinal), Answer);
        Assert.Contains("handler", disabled, StringComparison.Ordinal);

        // The half that matters more: the flood actually stops. An error reported sixty
        // four times a second costs the log, the boundary crossing and the unwind, and
        // it does it forever.
        server.ClearTranscript();
        await Task.Delay(TimeSpan.FromSeconds(2));
        Assert.DoesNotContain(server.Transcript,
            line => line.Contains("this tick handler always throws", StringComparison.Ordinal));
    }

    private static async Task<int> TickCountAsync(DedicatedServer server)
    {
        server.ClearTranscript();
        server.Command("css_hticks");

        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS ticks=", StringComparison.Ordinal), Answer);

        return int.Parse(line[(line.IndexOf("ticks=", StringComparison.Ordinal) + 6)..].Trim());
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
    public async Task TheWideSurfaceReachesTheSameFieldsTheFacadeDoes()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hentity");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS entity ", StringComparison.Ordinal), Answer);

        // A bot in the world has a pawn. Reaching here without one means the wide
        // surface reported absent for a player who is standing up, which is the one
        // thing its nullability must not do.
        Assert.DoesNotContain("no-pawn", line, StringComparison.Ordinal);

        var fields = line[(line.IndexOf("entity ", StringComparison.Ordinal) + 7)..]
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(field => field.Split('=', 2))
            .ToDictionary(field => field[0], field => field[1], StringComparer.Ordinal);

        // Two routes to one field. The curated member goes through CssPlayerOperations,
        // the generated one through its own property and its own schema name; a wrong
        // name in the second reads a different offset and these stop matching.
        Assert.Equal(Halves(fields["health"]).Curated, Halves(fields["health"]).Wide);
        Assert.Equal(Halves(fields["name"]).Curated, Halves(fields["name"]).Wide);

        // A write through the wide surface, read back through the facade.
        Assert.Equal("77/77", fields["armor"]);

        // The float write, read back through the field it was written to. The value
        // arrives from script as a double and the game holds a float; a narrowing that
        // landed anywhere else would show up here rather than as a rounding nobody sees.
        Assert.Equal("0.5", fields["velocity"]);

        // What resolve() does to a schema field, and what this must not do: it hands
        // script an object with nothing on it, in either direction, with nothing logged.
        // These four are every kind the generated surface carries.
        Assert.Equal("boolean", fields["scoped"]);
        Assert.Equal("number", fields["enum"]);
        Assert.Equal("string", fields["place"]);
        Assert.Equal("string", fields["wide"]);
    }

    private static (string Wide, string Curated) Halves(string pair)
    {
        var slash = pair.IndexOf('/', StringComparison.Ordinal);
        return (pair[..slash], pair[(slash + 1)..]);
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
