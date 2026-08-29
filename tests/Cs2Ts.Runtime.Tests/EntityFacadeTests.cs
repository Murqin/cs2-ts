using Cs2Ts.Runtime;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// The floor under the curated surface: <c>player.pawn</c> and <c>player.controller</c>,
/// and the wide per-entity surface hanging off each of them.
///
/// Two claims are what these are for. The shape — a pawn can be absent and the compiler
/// is the one that says so, a controller cannot — and the rule that the wide surface
/// obeys the same discipline as everything else here: it holds a way to find the entity,
/// never the entity, so it stays correct across a respawn instead of reading freed
/// memory.
/// </summary>
public sealed class EntityFacadeTests : IDisposable
{
    private readonly V8Runtime _runtime = new("entity-tests");
    private readonly V8ScriptEngine _engine;
    private readonly FakeWorld _world = new();
    private readonly FakeOperations _operations;
    private readonly PlayerFacadeTable<FakeController, FakePawn> _players;

    public EntityFacadeTests()
    {
        _engine = _runtime.CreateScriptEngine("entity-tests", V8ScriptEngineFlags.HideHostExceptions);
        _operations = new FakeOperations(_world);
        _players = new PlayerFacadeTable<FakeController, FakePawn>("player", _world.Resolve, _operations);
    }

    public void Dispose()
    {
        _engine.Dispose();
        _runtime.Dispose();
    }

    private PlayerFacade<FakeController, FakePawn> Expose(long userId, string name = "player")
    {
        var player = _players.For(userId);
        _engine.AddHostObject(name, player);
        return player;
    }

    [Fact]
    public void APlayerWithNoBodyHasNoPawn()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        Assert.NotNull(player.PawnEntity);

        // What a spectator is. The whole reason the pawn is a separate thing rather than
        // more members on the player: this case has an answer other than throwing.
        controller.Pawn = null;
        Assert.Null(player.PawnEntity);

        controller.Pawn = new FakePawn();
        Assert.NotNull(player.PawnEntity);
    }

    [Fact]
    public void TheControllerIsThereForAsLongAsThePlayerIs()
    {
        var controller = _world.Add(7);
        controller.Pawn = null;
        var player = _players.For(7);

        // No pawn, and the controller answers anyway. Nullability on these two means one
        // thing — not in the world — and making the controller nullable as well would
        // cost every script a check that can never fail.
        var entity = player.ControllerEntity;

        Assert.Equal("controller", entity.Kind);
        Assert.True(entity.IsValid);
        Assert.Equal("controller of player:7", entity.ToString());
    }

    [Fact]
    public void APlayerWhoLeftHasNeither()
    {
        _world.Add(7);
        var player = _players.For(7);
        _world.Disconnect(7);

        // Not null, and not a facade whose members throw one line later: gone is the same
        // failure the rest of the player reports, and reporting it here names the line
        // the author wrote.
        Assert.Throws<DeadEntityException>(() => player.PawnEntity);
        Assert.Throws<DeadEntityException>(() => player.ControllerEntity);
    }

    [Fact]
    public void OneEntityPerPlayer()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        var pawn = player.PawnEntity;
        Assert.Same(pawn, player.PawnEntity);
        Assert.Same(player.ControllerEntity, player.ControllerEntity);

        // A respawn replaces the pawn. The entity a script stored survives it, because
        // what it holds is a way to find the body rather than the body.
        controller.Pawn = new FakePawn { Health = 75 };
        Assert.Same(pawn, player.PawnEntity);
        Assert.Equal(75, ((FakePawnRaw)pawn!.Raw).Health);
    }

    [Fact]
    public void ReadsAndWritesGoThroughToTheGame()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);

        var pawn = (FakePawnRaw)player.PawnEntity!.Raw;
        pawn.Health = 55;
        pawn.ArmorValue = 77;

        Assert.Equal(55, controller.Pawn!.Health);
        Assert.Equal(77, controller.Pawn.Armor);
        Assert.Equal(55, pawn.Health);

        ((FakeControllerRaw)player.ControllerEntity.Raw).Score = 12345;
        Assert.Equal(12345, controller.Money);
    }

    [Fact]
    public void EveryFieldResolvesTheEntityAgain()
    {
        _world.Add(7);
        var player = _players.For(7);
        var pawn = (FakePawnRaw)player.PawnEntity!.Raw;

        var before = _world.PawnLookups;
        _ = pawn.Health;
        _ = pawn.ArmorValue;
        pawn.Health = 1;

        // Three accesses, three lookups, and the counter on the raw surface agrees. A
        // surface that resolved once and kept what it found would pass every value
        // assertion in this file and fail here.
        Assert.Equal(3, pawn.Resolutions);
        Assert.Equal(before + 3, _world.PawnLookups);
    }

    [Fact]
    public void AFieldOnAPawnThatHasGoneThrows()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);
        var entity = player.PawnEntity!;
        var pawn = (FakePawnRaw)entity.Raw;

        controller.Pawn = null;

        // Being handed the entity was an observation about that moment, not a promise
        // about this one. The guard is what a script checks instead.
        Assert.False(entity.IsValid);
        Assert.Throws<NoPawnException>(() => pawn.Health);
        Assert.Throws<NoPawnException>(() => pawn.Health = 1);

        _world.Disconnect(7);
        Assert.False(entity.IsValid);
        Assert.Throws<DeadEntityException>(() => pawn.Health);
    }

    [Fact]
    public void TheGuardNeverThrows()
    {
        var controller = _world.Add(7);
        var player = _players.For(7);
        var pawn = player.PawnEntity!;
        var controllerEntity = player.ControllerEntity;

        Assert.True(pawn.IsValid);

        controller.Pawn = null;
        Assert.False(pawn.IsValid);
        Assert.True(controllerEntity.IsValid);

        _world.Disconnect(7);
        Assert.False(pawn.IsValid);
        Assert.False(controllerEntity.IsValid);
    }

    // ---- what this looks like from script ----

    /// <summary>
    /// The test that earns <see cref="ScriptMemberFlags.ExposeRuntimeType"/> on
    /// <c>raw</c>. ClearScript binds a member's value against its declared type, and the
    /// declared type here is <see cref="object"/> because the runtime does not know the
    /// game — so without the flag every field below reads as undefined and every write
    /// is dropped, with nothing thrown and nothing logged.
    /// </summary>
    [Fact]
    public void ScriptReachesTheWideSurface()
    {
        var controller = _world.Add(7);
        controller.Pawn!.Health = 42;
        Expose(7);

        Assert.Equal(42, _engine.Evaluate("player.pawn.raw.health"));
        Assert.Equal(800, _engine.Evaluate("player.controller.raw.score"));

        _engine.Execute("player.pawn.raw.health = 55; player.pawn.raw.armorValue = 77;");
        Assert.Equal(55, controller.Pawn.Health);
        Assert.Equal(77, controller.Pawn.Armor);
    }

    [Fact]
    public void ScriptSeesOnlyWhatIsDeclared()
    {
        _world.Add(7);
        Expose(7);

        // A player's pawn is an entity like any other, and it gets the same members: the
        // guards, the wide surface, and the verbs that apply to anything in the world.
        // GetType is ClearScript's and cannot be hidden; AllowReflection staying false is
        // what makes it harmless.
        Assert.Equal(
            "GetType,designerName,index,input,isValid,kind,position,raw,remove,resolve,spawn,teleport,toString",
            _engine.Evaluate("Object.keys(player.pawn).sort().join(',')"));

        // And the wide surface is the fields and nothing else. Two things are being
        // pinned. The fake's Resolutions counter is public and does not appear, which is
        // the opt-out working on a class that will one day be generated with host-side
        // members on it. And neither do Equals, GetHashCode or ToString, which is
        // ScriptSurface working — opting out governs a type's own members, so before that
        // base class existed all three of object's turned up here among the fields.
        Assert.Equal(
            "GetType,armorValue,health",
            _engine.Evaluate("Object.keys(player.pawn.raw).sort().join(',')"));
    }

    [Fact]
    public void ScriptSeesNullForAPlayerWithNoBody()
    {
        var controller = _world.Add(7);
        controller.Pawn = null;
        Expose(7);

        // null rather than undefined, and rather than an object that throws on use: it
        // is the value the declarations promise, so `player.pawn?.raw` works.
        Assert.Equal(true, _engine.Evaluate("player.pawn === null"));
        Assert.Equal(Undefined.Value, _engine.Evaluate("player.pawn?.raw.health"));
    }

    [Fact]
    public void ScriptSeesOneObjectPerEntity()
    {
        _world.Add(7);
        Expose(7);

        // Same as for players: identity comparison is something an author will reach
        // for, and it has to be true rather than accidentally false.
        Assert.Equal(true, _engine.Evaluate("player.pawn === player.pawn"));
        Assert.Equal(true, _engine.Evaluate("player.controller === player.controller"));
        Assert.Equal("pawn of player:7", _engine.Evaluate("`${player.pawn}`"));
    }

    [Fact]
    public void ScriptCanCatchWhatTheWideSurfaceThrows()
    {
        _world.Add(7);
        Expose(7);
        _world.Disconnect(7);

        var caught = _engine.Evaluate(
            """
            (() => {
                try {
                    return player.pawn.raw.health;
                } catch (e) {
                    return `${e instanceof Error} ${e.message}`;
                }
            })()
            """);

        Assert.Equal("true player 7 is no longer in the game", caught);
    }
}
