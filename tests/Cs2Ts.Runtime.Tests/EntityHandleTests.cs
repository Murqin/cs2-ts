using Cs2Ts.Runtime;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime.Tests;

public sealed class EntityHandleTests : IDisposable
{
    /// <summary>
    /// Stands in for a CounterStrikeSharp controller. What matters for these tests is
    /// that it can stop being valid while a handle to it is still held, which is the
    /// situation the whole design exists for.
    /// </summary>
    public sealed class FakePlayer(long userId, string name)
    {
        public long UserId { get; } = userId;

        public string Name { get; } = name;

        public int Health { get; set; } = 100;

        public bool IsValid { get; set; } = true;
    }

    /// <summary>A game world a test can kill players in.</summary>
    private sealed class FakeWorld
    {
        private readonly Dictionary<long, FakePlayer> _players = [];

        public int Lookups { get; private set; }

        public FakePlayer Add(long userId, string name)
        {
            var player = new FakePlayer(userId, name);
            _players[userId] = player;
            return player;
        }

        public void Disconnect(long userId) => _players.Remove(userId);

        /// <summary>
        /// The resolver a handle table is built on. It returns null for a player who
        /// left and for one who is still in the dictionary but no longer valid, because
        /// a script cannot tell those apart and should not have to.
        /// </summary>
        public FakePlayer? Resolve(long userId)
        {
            Lookups++;
            return _players.TryGetValue(userId, out var player) && player.IsValid ? player : null;
        }
    }

    private readonly V8Runtime _runtime = new("handle-tests");
    private readonly V8ScriptEngine _engine;
    private readonly FakeWorld _world = new();
    private readonly EntityHandleTable<FakePlayer> _players;

    public EntityHandleTests()
    {
        // HideHostExceptions keeps the .NET exception object off the JavaScript error:
        // without it a script can read e.hostException and walk into the host from
        // there, which is not something a plugin should be able to do.
        _engine = _runtime.CreateScriptEngine("handle-tests", V8ScriptEngineFlags.HideHostExceptions);
        _players = new EntityHandleTable<FakePlayer>("player", _world.Resolve);
    }

    public void Dispose()
    {
        _engine.Dispose();
        _runtime.Dispose();
    }

    [Fact]
    public void ResolvesALivePlayer()
    {
        _world.Add(7, "murqin");
        var handle = _players.For(7);

        Assert.True(handle.IsValid);
        Assert.Equal("murqin", handle.Read(p => p.Name));
        Assert.Equal(7, handle.Id);
        Assert.Equal("player", handle.Kind);
    }

    /// <summary>
    /// The scenario from the design: a script keeps a reference and comes back to it
    /// later. With a cached pointer this is a use-after-free; with a handle it is an
    /// exception the script can catch.
    /// </summary>
    [Fact]
    public void ThrowsRatherThanReturningStaleDataAfterThePlayerLeaves()
    {
        _world.Add(7, "murqin");
        var handle = _players.For(7);
        Assert.Equal(100, handle.Read(p => p.Health));

        _world.Disconnect(7);

        Assert.False(handle.IsValid);
        var error = Assert.Throws<DeadEntityException>(() => handle.Resolve());
        Assert.Equal("player", error.Kind);
        Assert.Equal(7, error.Id);
        Assert.Equal("player 7 is no longer in the game", error.Message);
    }

    /// <summary>
    /// An entity can still be in the world and yet not be usable. Treating that as
    /// alive is how a plugin ends up writing to a pawn that is mid-teardown.
    /// </summary>
    [Fact]
    public void TreatsAnInvalidPlayerAsGone()
    {
        var player = _world.Add(7, "murqin");
        var handle = _players.For(7);

        player.IsValid = false;

        Assert.False(handle.IsValid);
        Assert.Throws<DeadEntityException>(() => handle.Resolve());
        Assert.Null(handle.Find());
    }

    /// <summary>
    /// The rule the class exists to enforce. If the handle cached what it resolved, a
    /// second read after the player left would hand back the old object.
    /// </summary>
    [Fact]
    public void ResolvesAgainOnEveryAccessRatherThanCaching()
    {
        _world.Add(7, "murqin");
        var handle = _players.For(7);

        var before = _world.Lookups;
        _ = handle.IsValid;
        _ = handle.Read(p => p.Health);
        _ = handle.Find();

        Assert.Equal(before + 3, _world.Lookups);
    }

    [Fact]
    public void SeesAValueChangedOnTheEntityAfterTheHandleWasMade()
    {
        var player = _world.Add(7, "murqin");
        var handle = _players.For(7);

        player.Health = 42;

        Assert.Equal(42, handle.Read(p => p.Health));
    }

    /// <summary>
    /// A player who reconnects on the same identity is reachable through a handle taken
    /// before they left. That falls out of storing the identity rather than the entity.
    /// </summary>
    [Fact]
    public void StartsWorkingAgainIfTheIdentityComesBack()
    {
        _world.Add(7, "murqin");
        var handle = _players.For(7);
        _world.Disconnect(7);
        Assert.False(handle.IsValid);

        _world.Add(7, "murqin");

        Assert.True(handle.IsValid);
        Assert.Equal("murqin", handle.Read(p => p.Name));
    }

    [Fact]
    public void GivesTheSameHandleForTheSameIdentity()
    {
        _world.Add(7, "murqin");

        Assert.Same(_players.For(7), _players.For(7));
        Assert.NotSame(_players.For(7), _players.For(8));
        Assert.Equal(2, _players.Count);
    }

    [Fact]
    public void ClearForgetsIdentitiesWithoutAffectingHandlesAlreadyHandedOut()
    {
        _world.Add(7, "murqin");
        var before = _players.For(7);

        _players.Clear();

        Assert.Equal(0, _players.Count);
        Assert.True(before.IsValid);
        Assert.Equal(before, _players.For(7));
        Assert.NotSame(before, _players.For(7));
    }

    [Fact]
    public void UseRunsAgainstTheLiveEntityAndThrowsWhenItIsGone()
    {
        var player = _world.Add(7, "murqin");
        var handle = _players.For(7);

        handle.Use(p => p.Health = 55);
        Assert.Equal(55, player.Health);

        _world.Disconnect(7);
        Assert.Throws<DeadEntityException>(() => handle.Use(p => p.Health = 1));
    }

    // ---- the script side, which is what all of the above is for ----

    private object? Eval(string script)
    {
        _engine.Script.player = _players.For(7);
        _engine.Script.other = _players.For(8);
        return _engine.Evaluate(new DocumentInfo("plugin.ts"), script);
    }

    [Fact]
    public void ScriptReadsIdentityWithoutTouchingTheEntity()
    {
        _world.Add(7, "murqin");
        _world.Add(8, "someone");

        var before = _world.Lookups;
        Assert.Equal("player:7", Eval("player.toString()"));
        Assert.Equal(7, Eval("player.id"));
        Assert.Equal("player", Eval("player.kind"));

        // Identity is answered from the handle; none of that needed the game.
        Assert.Equal(before, _world.Lookups);
    }

    /// <summary>
    /// The design's third requirement, and the one that separates this from a crash:
    /// a dead entity has to reach script as something script can catch.
    /// </summary>
    [Fact]
    public void ScriptCatchesTheDeadEntityErrorLikeAnyOtherError()
    {
        _world.Add(7, "murqin");
        _world.Add(8, "someone");
        _world.Disconnect(7);

        var report = Eval(
            """
            (function () {
                try {
                    player.resolve();
                    return "no throw";
                } catch (e) {
                    return [e instanceof Error, e.message, typeof e.hostException].join("|");
                }
            })()
            """);

        Assert.Equal("true|player 7 is no longer in the game|undefined", report);
    }

    [Fact]
    public void ScriptChecksValidityCheaplyBeforeDoingWork()
    {
        _world.Add(7, "murqin");
        _world.Add(8, "someone");
        _world.Disconnect(7);

        Assert.Equal(false, Eval("player.isValid"));
        Assert.Equal(true, Eval("other.isValid"));
        Assert.Equal("skipped", Eval("player.isValid ? 'ran' : 'skipped'"));
    }

    /// <summary>
    /// What Valve's cs_script gives map authors, and what a scripting layer feels
    /// broken without: the player handed to one callback is the same object as the one
    /// stored by another.
    /// </summary>
    [Fact]
    public void ScriptComparesTwoReferencesToTheSamePlayerWithTripleEquals()
    {
        _world.Add(7, "murqin");
        _world.Add(8, "someone");

        _engine.Script.first = _players.For(7);
        _engine.Script.second = _players.For(7);
        _engine.Script.third = _players.For(8);

        Assert.Equal(true, _engine.Evaluate("first === second"));
        Assert.Equal(false, _engine.Evaluate("first === third"));
    }

    /// <summary>
    /// Opting out by default means a member added to the handle is not script-visible
    /// until someone says so, rather than the other way round.
    /// </summary>
    [Fact]
    public void ScriptSeesOnlyTheAnnotatedMembers()
    {
        _world.Add(7, "murqin");
        _world.Add(8, "someone");

        // GetType is ClearScript's, not ours; everything else here is what we declared.
        Assert.Equal("GetType,id,isValid,kind,resolve,toString", Eval("Object.keys(player).sort().join(',')"));

        foreach (var hidden in new[] { "Read", "Use", "Find", "Equals", "GetHashCode", "ToString" })
        {
            Assert.Equal(true, Eval($"typeof player.{hidden} === 'undefined'"));
        }
    }

    /// <summary>
    /// GetType is the one member ClearScript always puts on a host object, so member
    /// hiding is not what keeps a script out of the host — AllowReflection does, and it
    /// is false by default. Turning it on for convenience somewhere would open the way
    /// from any handle to its assembly and out of the sandbox, which is why this pins
    /// the setting rather than the symptom.
    /// </summary>
    [Fact]
    public void ScriptCannotReflectFromAHandleIntoTheHost()
    {
        _world.Add(7, "murqin");
        _world.Add(8, "someone");

        Assert.False(_engine.AllowReflection);

        var error = Assert.Throws<ScriptEngineException>(() => Eval("player.GetType().Assembly"));
        Assert.Contains("reflection is prohibited", error.Message);
    }

    /// <summary>
    /// The escape hatch: resolve() hands over the host object, so a script can reach
    /// what the facade does not cover. It costs the script its safety net, which is
    /// why it is not how anything else here works.
    /// </summary>
    [Fact]
    public void ScriptReachesTheHostObjectThroughResolve()
    {
        _world.Add(7, "murqin");
        _world.Add(8, "someone");

        Assert.Equal("murqin", Eval("player.resolve().Name"));
        Assert.Equal(100, Eval("player.resolve().Health"));
    }

    /// <summary>
    /// Resolution is on the path of every property access, so its cost is the tax the
    /// whole design pays. Phase 0 measured 0.40 µs against a live server; this only
    /// pins that the handle itself adds nothing of a different order.
    /// </summary>
    [Fact]
    public void ResolutionStaysCheap()
    {
        _world.Add(7, "murqin");
        var handle = _players.For(7);

        for (var i = 0; i < 10_000; i++)
        {
            _ = handle.IsValid;
        }

        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        for (var i = 0; i < 100_000; i++)
        {
            _ = handle.IsValid;
        }

        var per = System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMicroseconds / 100_000;
        Assert.True(per < 1.0, $"handle resolution took {per:F3} µs against a dictionary");
    }
}
