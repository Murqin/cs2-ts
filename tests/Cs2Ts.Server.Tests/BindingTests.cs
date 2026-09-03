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

    /// <summary>
    /// <c>players.select</c> against a real roster: the specifier resolves to facades,
    /// a bad keyword is refused. The set sizes are loose on purpose — the suite's bot
    /// count moves — so the assertions are that it ran, returned something for
    /// <c>@all</c>, and threw for nonsense.
    /// </summary>
    [Fact]
    public async Task TargetSpecifiersResolveAgainstARealRoster()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.ClearTranscript();
        server.Command("css_hselect");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS select ", StringComparison.Ordinal), Answer);

        Assert.Matches(@"all=[1-9]\d*", line);
        Assert.Contains("refused=yes", line, StringComparison.Ordinal);
    }

    /// <summary>
    /// A command gated behind an admin flag still runs from the console, which holds
    /// every permission, and <c>cs2ts_status</c> counts it. A player without the flag
    /// being turned away needs a client and is checked by hand.
    /// </summary>
    [Fact]
    public async Task AGatedCommandRunsFromTheConsoleAndIsCounted()
    {
        var server = fixture.Require();

        server.ClearTranscript();
        server.Command("css_hgated");
        await server.WaitForAsync(
            line => line.Contains("HARNESS gated ran", StringComparison.Ordinal), Answer);

        server.ClearTranscript();
        server.Command("cs2ts_status");
        var status = await server.WaitForAsync(
            line => line.Contains("[CS2-TS] permission-gated commands:", StringComparison.Ordinal), Answer);
        Assert.Contains("permission-gated commands: 1", status, StringComparison.Ordinal);
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

    /// <summary>
    /// A kept centre message is a real re-send loop on the game thread: the runtime
    /// sends it again every tick until it is cleared. What the client shows cannot be
    /// read back from here, so the check is on the count the status command reports —
    /// and on the whole path running without a boundary error, which a fake cannot prove
    /// because PrintToCenterHtml is CounterStrikeSharp's.
    /// </summary>
    [Fact]
    public async Task AKeptCentreMessageIsCountedAndThenCleared()
    {
        var server = await fixture.RequireWithPlayersAsync();

        try
        {
            server.ClearTranscript();
            server.Command("css_hcenter");
            await server.WaitForAsync(
                l => l.Contains("HARNESS center shown", StringComparison.Ordinal), Answer);

            server.ClearTranscript();
            server.Command("cs2ts_status");
            var shown = await server.WaitForAsync(
                l => l.Contains("[CS2-TS] centre messages:", StringComparison.Ordinal), Answer);
            Assert.Contains("centre messages: 1", shown, StringComparison.Ordinal);

            server.ClearTranscript();
            server.Command("css_hcenterclear");
            await server.WaitForAsync(
                l => l.Contains("HARNESS center cleared", StringComparison.Ordinal), Answer);

            server.ClearTranscript();
            server.Command("cs2ts_status");
            var cleared = await server.WaitForAsync(
                l => l.Contains("[CS2-TS] centre messages:", StringComparison.Ordinal), Answer);
            Assert.Contains("centre messages: 0", cleared, StringComparison.Ordinal);

            // The re-send ran every tick in between and nothing was reported against the
            // script — a throw in ResendCenterMessage would be here.
            Assert.DoesNotContain(server.Transcript,
                line => line.Contains("[CS2-TS]", StringComparison.Ordinal)
                    && line.Contains("hcenter", StringComparison.Ordinal)
                    && line.Contains("Error", StringComparison.Ordinal));
        }
        finally
        {
            server.Command("css_hcenterclear");
        }
    }

    /// <summary>
    /// A centre menu, opened for a bot and closed again. Its re-send runs on the game
    /// thread every tick; selection and navigation need a client and are checked by
    /// hand. What this holds is the open count, that the handle reports itself open, and
    /// that the whole path — parse, open, re-send, close — runs without a boundary error.
    /// </summary>
    [Fact]
    public async Task AMenuIsCountedWhileOpenAndGoneAfterItCloses()
    {
        var server = await fixture.RequireWithPlayersAsync();

        try
        {
            server.ClearTranscript();
            server.Command("css_hmenu");
            var opened = await server.WaitForAsync(
                l => l.Contains("HARNESS menu opened", StringComparison.Ordinal), Answer);
            Assert.Contains("isOpen=true", opened, StringComparison.Ordinal);

            server.ClearTranscript();
            server.Command("cs2ts_status");
            var shown = await server.WaitForAsync(
                l => l.Contains("[CS2-TS] open menus:", StringComparison.Ordinal), Answer);
            Assert.Contains("open menus: 1", shown, StringComparison.Ordinal);

            server.ClearTranscript();
            server.Command("css_hmenuclose");
            var closed = await server.WaitForAsync(
                l => l.Contains("HARNESS menu closed", StringComparison.Ordinal), Answer);
            Assert.Contains("isOpen=false", closed, StringComparison.Ordinal);

            server.ClearTranscript();
            server.Command("cs2ts_status");
            var cleared = await server.WaitForAsync(
                l => l.Contains("[CS2-TS] open menus:", StringComparison.Ordinal), Answer);
            Assert.Contains("open menus: 0", cleared, StringComparison.Ordinal);
        }
        finally
        {
            server.Command("css_hmenuclose");
        }
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
    public async Task AGameEventArrivesWithTheFieldsTheGeneratorPromised()
    {
        var server = await fixture.RequireWithPlayersAsync();

        try
        {
            server.ClearTranscript();

            // bot_kill is a cheat command; without this it is refused and the test would
            // read as "the event never arrived" rather than "nothing died".
            server.Command("sv_cheats 1");
            server.Command("bot_kill");
            await Task.Delay(TimeSpan.FromSeconds(2));

            server.Command("css_hdeath");
            var line = await server.WaitForAsync(
                l => l.Contains("HARNESS death ", StringComparison.Ordinal), Answer);

            // The event was hooked because a script asked for it, and only then: nothing
            // in this plugin registers player_death in advance.
            Assert.DoesNotContain("none", line, StringComparison.Ordinal);
            Assert.Contains("player=true", line, StringComparison.Ordinal);

            // bot_kill reads as a suicide rather than as a kill by the world, which was
            // measured rather than assumed. That makes it the better test: one player in
            // two fields of one event has to arrive as one object, or `===` stops meaning
            // anything for the thing scripts are told to keep.
            Assert.Contains("attacker=player", line, StringComparison.Ordinal);
            Assert.Contains("same=true", line, StringComparison.Ordinal);

            // And the three kinds arrive as themselves rather than as the empty object a
            // schema field turns into on the way across.
            Assert.Contains("headshot=boolean", line, StringComparison.Ordinal);
            Assert.Contains("weapon=string", line, StringComparison.Ordinal);
            Assert.Contains("dmg=number", line, StringComparison.Ordinal);
        }
        finally
        {
            // Put the bots back on their feet, and the server back as it was. Nothing
            // here waits for a round to end on its own, and the next test to ask for
            // players would otherwise wait a minute and then fail.
            server.Command("sv_cheats 0");
            server.Command("mp_restartgame 1");
        }
    }

    [Fact]
    public async Task AnEventNameNoGameEventHasIsReported()
    {
        var server = fixture.Require();

        server.ClearTranscript();
        server.Command("css_hbadevent");

        // The declarations would have stopped a TypeScript author. This is what a
        // JavaScript author gets instead of a handler that is registered and can never
        // fire — and the plugin can only say it because the generated switch is the
        // list of every event the game has.
        var warning = await server.WaitForAsync(
            line => line.Contains("no game event is called", StringComparison.Ordinal), Answer);

        Assert.Contains("player_hrut", warning, StringComparison.Ordinal);
    }

    /// <summary>
    /// The entity list, and the identity over it. Nothing here has a fake that can fail
    /// the same way: the lookup walks the game's own entity list, and the identity is the
    /// handle the game itself keeps.
    /// </summary>
    [Fact]
    public async Task TheWorldCanBeSearchedAndOneEntityIsOneObject()
    {
        var server = fixture.Require();

        server.Command("css_hentworld");
        var fields = Fields(await server.WaitForAsync(
            l => l.Contains("HARNESS entworld ", StringComparison.Ordinal), Answer), "entworld ");

        // A stock map is a couple of thousand entities before anyone joins. One would
        // mean the walk stopped at the head of the list.
        Assert.True(int.Parse(fields["count"]) > 100, $"only {fields["count"]} entities");

        // Two lookups of one entity are one object, which is what makes `===` usable.
        Assert.Equal("true", fields["same"]);
        Assert.Equal("true", fields["named"]);

        // Exact rather than CounterStrikeSharp's substring search, which would also
        // return every classname that merely contains this one.
        Assert.Equal("true", fields["exact"]);
        Assert.Equal("true", fields["valid"]);
        Assert.Equal("number", fields["index"]);
    }

    /// <summary>
    /// The same pawn reached from both directions: through the player, and through the
    /// entity list by index. The two have to agree about health, or one of them is
    /// reading a different object — and the wide surface here is the generated
    /// CBaseEntity one, reached by schema names nobody has checked before.
    /// </summary>
    [Fact]
    public async Task APawnFoundThroughTheEntityListIsTheSamePawn()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hentpawn");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS entpawn ", StringComparison.Ordinal), Answer);

        Assert.DoesNotContain("no-pawn", line, StringComparison.Ordinal);
        var fields = Fields(line, "entpawn ");

        Assert.Equal("true", fields["found"]);
        Assert.Equal("pawn", fields["kind"]);
        Assert.Equal(Halves(fields["health"]).Curated, Halves(fields["health"]).Wide);
        Assert.Equal(Halves(fields["team"]).Curated, Halves(fields["team"]).Wide);

        // The classname of a player's body, which is also proof that DesignerName is
        // reading the entity's identity rather than an empty string.
        Assert.NotEmpty(fields["name"]);
    }

    [Fact]
    public async Task AnEntityIsAWayIntoTheEscapeHatch()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hentunsafe");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS entunsafe ", StringComparison.Ordinal), Answer);

        // Three routes to one field: unsafe by name, the generated surface, and the
        // player facade. The middle one is what this step added; without the first two
        // agreeing with it there would be nothing to check it against.
        Assert.Contains("host=41 raw=41 facade=41", line, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AsReachesAClassSOwnFieldsAndRefusesANameTheGameDoesNotBind()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hentas");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS entas ", StringComparison.Ordinal), Answer);

        var fields = line[(line.IndexOf("entas ", StringComparison.Ordinal) + 6)..]
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(field => field.Split('=', 2))
            .ToDictionary(field => field[0], field => field[1], StringComparer.Ordinal);

        // armorValue is CCSPlayerPawn's own — raw, the CBaseEntity floor, does not have
        // it. as("CCSPlayerPawn") does, and it comes back a number rather than the empty
        // object a schema field is through resolve().
        Assert.Equal("number", fields["armor"]);

        // health is CBaseEntity's, so as("CCSPlayerPawn") reaches it by inheriting and
        // as("CBaseEntity") directly. Both, and the curated facade, read one field.
        Assert.Equal(fields["facade"], fields["health"]);
        Assert.Equal(fields["facade"], fields["baseHealth"]);

        // The one check as makes: the same one unsafe makes on its class argument. A
        // name the game does not bind has no factory, so it is refused here rather than
        // reading another class's bytes at the same offsets.
        Assert.Equal("yes", fields["refused"]);
    }

    [Fact]
    public async Task AnEntityCanBeMadeAndPutSomewhere()
    {
        var server = fixture.Require();

        try
        {
            server.Command("css_hentmake");
            var fields = Fields(await server.WaitForAsync(
                l => l.Contains("HARNESS entmake ", StringComparison.Ordinal), Answer), "entmake ");

            Assert.Equal("info_target", fields["name"]);
            Assert.Equal("true", fields["valid"]);
            Assert.Equal("number", fields["index"]);

            // Written before the spawn and still there after it, which is the whole
            // reason creating and spawning are two steps.
            Assert.Equal("2", fields["team"]);

            // Moved after spawning, and read back out of the entity rather than out of
            // what was passed in.
            Assert.Equal("128", fields["x"]);

            // The generated surface on something that is not a player at all.
            Assert.Equal("number", fields["health"]);
            Assert.Equal("number", fields["flags"]);
        }
        finally
        {
            server.Command("css_hentgone");
        }
    }

    [Fact]
    public async Task AClassnameTheGameDoesNotKnowIsRefused()
    {
        var server = fixture.Require();

        server.Command("css_hentbadname");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS entbadname ", StringComparison.Ordinal), Answer);

        // Unrefused this hands back an object over a null pointer, and every call on it
        // does nothing. A typo would look like a feature that quietly does not work.
        Assert.Contains("refused", line, StringComparison.Ordinal);
        Assert.Contains("no_such_entity_class", line, StringComparison.Ordinal);
    }

    /// <summary>
    /// The claim the whole table is built on, against a real engine: a removed entity
    /// stays removed, and a reference to it does not follow the slot to whatever the
    /// game puts there next.
    /// </summary>
    [Fact]
    public async Task AReferenceDoesNotFollowASlotToItsNextOccupant()
    {
        var server = fixture.Require();

        server.Command("css_hentmake");
        await server.WaitForAsync(l => l.Contains("HARNESS entmake ", StringComparison.Ordinal), Answer);

        server.ClearTranscript();
        server.Command("css_hentgone");
        var fields = Fields(await server.WaitForAsync(
            l => l.Contains("HARNESS entgone ", StringComparison.Ordinal), Answer), "entgone ");

        // Whether the slot came back is the game's business and not something to assert.
        // What must hold either way is that the old reference is dead and the new entity
        // is a different object.
        Assert.Equal("false", fields["valid"]);
        Assert.Equal("false", fields["same"]);

        // And a dead reference answers rather than throwing, because these two are what
        // a script puts in a log line.
        Assert.Equal("-1", fields["index"]);
        Assert.Equal("", fields["name"]);
    }

    /// <summary>
    /// A field that holds another entity, against a real one. The controller keeps its
    /// own handle to the pawn, so the body is reachable without going through the player
    /// — and it has to be the same body, or the handle is being read as a wrong number
    /// and answering with whatever lives at that slot.
    /// </summary>
    [Fact]
    public async Task AFieldHoldingAnotherEntityResolvesToThatEntity()
    {
        var server = await fixture.RequireWithPlayersAsync();

        server.Command("css_hhandle");
        var line = await server.WaitForAsync(
            l => l.Contains("HARNESS handle ", StringComparison.Ordinal), Answer);

        Assert.DoesNotContain("no-pawn", line, StringComparison.Ordinal);
        var fields = Fields(line, "handle ");

        Assert.Equal("true", fields["found"]);

        // The controller's own pointer to the pawn is the pawn: same slot, same health.
        Assert.Equal(Halves(fields["index"]).Curated, Halves(fields["index"]).Wide);
        Assert.Equal(Halves(fields["health"]).Curated, Halves(fields["health"]).Wide);

        // And it is the same object as the one the entity list hands out, which is what
        // one table for the whole server buys.
        Assert.Equal("true", fields["same"]);

        // A player standing on the map is standing on an entity; in the air they are
        // standing on nothing, and both are answers rather than a throw.
        Assert.Contains(fields["ground"], new[] { "null", "string" });

        // A handle that points at nothing reads as null rather than as an entity at
        // slot 32767. Every player has an empty split-screen owner.
        Assert.Equal("true", fields["empty"]);
    }

    /// <summary>
    /// A plugin split across two files, on a real server.
    ///
    /// Every part of this only exists inside the running process: discovery walks the
    /// operator's own scripts folder, the import is resolved against the plugin's folder,
    /// and the imported file is stripped by the TypeScript parser running inside CS2 on
    /// the game thread. Until this step the shipped tsconfig accepted the import and the
    /// server answered "Cannot use import statement outside a module".
    /// </summary>
    [Fact]
    public async Task AFolderPluginImportsItsOwnModule()
    {
        var server = fixture.Require();

        // Named by its folder, and the entry file named with it: five folder plugins
        // would otherwise report five identical "index.ts".
        Assert.Contains(server.Transcript,
            line => line.Contains("loaded hmodule/index.ts", StringComparison.Ordinal));

        server.Command("css_hmodule");
        var fields = Fields(await server.WaitForAsync(
            l => l.Contains("HARNESS module ", StringComparison.Ordinal), Answer), "module ");

        // Both a constant and a function from the imported file, so a module that was
        // found but not evaluated would fail here rather than pass quietly.
        Assert.Equal("7", fields["factor"]);
        Assert.Equal("42", fields["times"]);

        // Its own top-level name, which harness.ts also has. Running every plugin as a
        // module is what makes that a non-question.
        Assert.Equal("module-scoped", fields["scope"]);
    }

    /// <summary>Splits a "key=value key=value" tail into a dictionary.</summary>
    private static Dictionary<string, string> Fields(string line, string after) =>
        line[(line.IndexOf(after, StringComparison.Ordinal) + after.Length)..]
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(field => field.Split('=', 2))
            .ToDictionary(field => field[0], field => field.Length > 1 ? field[1] : "", StringComparer.Ordinal);

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
