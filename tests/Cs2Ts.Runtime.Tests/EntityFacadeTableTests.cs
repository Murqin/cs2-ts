using Cs2Ts.Runtime;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// The table that hands out entities, and the one claim it exists to make: an identity
/// is a slot <em>and</em> a serial number, never a slot on its own.
///
/// Everything here is about slot reuse, because that is the failure the game produces on
/// its own several times a round. A grenade is thrown, explodes and gives its index back;
/// the next thing created takes it. A reference keyed by index alone would resolve
/// perfectly and be pointing at something else, with nothing thrown and nothing logged —
/// the same class of bug as a recycled userid, and rather more frequent.
/// </summary>
public sealed class EntityFacadeTableTests : IDisposable
{
    private readonly V8Runtime _runtime = new("entity-table-tests");
    private readonly V8ScriptEngine _engine;
    private readonly FakeEntityWorld _world = new();

    public EntityFacadeTableTests() =>
        _engine = _runtime.CreateScriptEngine("entity-table-tests", V8ScriptEngineFlags.HideHostExceptions);

    public void Dispose()
    {
        _engine.Dispose();
        _runtime.Dispose();
    }

    [Fact]
    public void OneFacadePerEntity()
    {
        var entity = _world.Spawn(42);

        var first = _world.For(entity);
        Assert.NotNull(first);
        Assert.Same(first, _world.For(entity));
    }

    [Fact]
    public void AHandleThatNamesNothingIsNull()
    {
        Assert.Null(_world.Table.For(0));
        Assert.Equal(0, _world.Table.Count);
    }

    [Fact]
    public void ASlotIsNotAnIdentity()
    {
        var grenade = _world.Spawn(42, "hegrenade_projectile");
        var facade = _world.For(grenade)!;

        _world.Destroy(42);
        Assert.False(facade.IsValid);

        // The same slot, a different thing in it. The old reference has to stay dead:
        // resolving it would hand a script the new entity under the old name, which is
        // the whole failure this table is built around.
        var weapon = _world.Spawn(42, "weapon_ak47");
        Assert.False(facade.IsValid);
        Assert.NotSame(facade, _world.For(weapon));
        Assert.Equal("weapon_ak47", _world.For(weapon)!.DesignerName);
    }

    [Fact]
    public void ADeadFacadeStillSaysWhatItWas()
    {
        var entity = _world.Spawn(42, "weapon_ak47");
        var facade = _world.For(entity)!;

        Assert.Equal(42, facade.Index);
        Assert.Equal("weapon_ak47", facade.DesignerName);
        Assert.Equal("weapon_ak47:42", facade.ToString());

        _world.Destroy(42);

        // Two different answers on purpose. What it was is a fact and stays readable —
        // toString is what ends up in a log line, and a log line must not throw. What it
        // is now is a question about the game, and the honest answer is nothing.
        Assert.Equal("weapon_ak47:42", facade.ToString());
        Assert.Equal(-1, facade.Index);
        Assert.Equal("", facade.DesignerName);
        Assert.False(facade.IsValid);
    }

    [Fact]
    public void EveryMemberResolvesTheEntityAgain()
    {
        var entity = _world.Spawn(42);
        var facade = _world.For(entity)!;

        var before = _world.Lookups;
        _ = facade.Index;
        _ = facade.Position;
        facade.Teleport(1, 2, 3);

        // Four, not three. Position and teleport are one lookup each; index is two,
        // because it asks whether the entity is there before asking the entity anything,
        // which is what lets it answer -1 instead of throwing. The number matters less
        // than that it is not zero: a facade that resolved once and kept what it found
        // would pass every value assertion in this file and fail here.
        Assert.Equal(before + 4, _world.Lookups);
        Assert.Equal(new List<string> { "teleport=1,2,3" }, entity.Verbs);
    }

    [Fact]
    public void TheVerbsReachTheGame()
    {
        var entity = _world.Spawn(42);
        var facade = _world.For(entity)!;

        facade.Spawn();
        facade.Input("TurnOn");
        facade.Input("AddOutput", "targetname box");
        facade.Remove();

        Assert.Equal(
            new List<string> { "spawn", "input:TurnOn=", "input:AddOutput=targetname box", "remove" },
            entity.Verbs);
    }

    [Fact]
    public void AVerbOnAnEntityThatIsGoneThrows()
    {
        var entity = _world.Spawn(42);
        var facade = _world.For(entity)!;
        _world.Destroy(42);

        Assert.Throws<DeadEntityException>(() => facade.Position);
        Assert.Throws<DeadEntityException>(() => facade.Teleport(1, 2, 3));
        Assert.Throws<DeadEntityException>(facade.Remove);
        Assert.Throws<DeadEntityException>(() => facade.Input("Kill"));
        Assert.Throws<DeadEntityException>(() => facade.Resolve());
    }

    [Fact]
    public void DeadEntitiesAreSweptOut()
    {
        // Past the sweep threshold, one at a time, killing each as it goes. This is the
        // grenade case: a table keyed by a live identity would otherwise grow for as long
        // as the map runs, because nothing ever asks about a dead handle again.
        for (var index = 1; index <= 400; index++)
        {
            var entity = _world.Spawn(index);
            Assert.NotNull(_world.For(entity));
            _world.Destroy(index);
        }

        Assert.True(_world.Table.Count < 400, $"the table kept {_world.Table.Count} dead entities");
    }

    [Fact]
    public void LiveEntitiesSurviveASweep()
    {
        var entities = new List<FakeEntity>();
        var kept = new List<EntityFacade>();

        for (var index = 1; index <= 400; index++)
        {
            var entity = _world.Spawn(index);
            entities.Add(entity);
            kept.Add(_world.For(entity)!);
        }

        // Nothing died, so nothing may be dropped: a sweep that took a live entity would
        // hand a second facade to a script that had already stored the first, and `===`
        // would start answering false for reasons nobody could see.
        Assert.Equal(400, _world.Table.Count);
        Assert.All(kept, facade => Assert.True(facade.IsValid));
        Assert.Same(kept[0], _world.For(entities[0]));
    }

    [Fact]
    public void ClearForgetsEverything()
    {
        var entity = _world.Spawn(42);
        var facade = _world.For(entity)!;

        _world.Table.Clear();

        Assert.Equal(0, _world.Table.Count);
        Assert.NotSame(facade, _world.For(entity));
    }

    // ---- what this looks like from script ----

    [Fact]
    public void ScriptSeesOnlyWhatIsDeclared()
    {
        _engine.AddHostObject("entity", _world.For(_world.Spawn(42))!);

        // GetType is ClearScript's and cannot be hidden; AllowReflection staying false is
        // what makes it harmless. Everything else here is deliberate.
        Assert.Equal(
            "GetType,as,designerName,index,input,isValid,kind,position,raw,remove,resolve,spawn,teleport,toString",
            _engine.Evaluate("Object.keys(entity).sort().join(',')"));
    }

    [Fact]
    public void ScriptReachesTheWideSurfaceAndTheVerbs()
    {
        var entity = _world.Spawn(42, "prop_physics_override");
        _engine.AddHostObject("entity", _world.For(entity)!);

        Assert.Equal(42, _engine.Evaluate("entity.index"));
        Assert.Equal("prop_physics_override", _engine.Evaluate("entity.designerName"));
        Assert.Equal("prop_physics_override:42", _engine.Evaluate("`${entity}`"));

        // raw only reads as anything at all because of ExposeRuntimeType on the member;
        // bound against its declared type it would be an object with nothing on it.
        _engine.Execute("entity.raw.teamNum = 2; entity.teleport(10, 20, 30); entity.input('TurnOn');");

        Assert.Equal(2, entity.TeamNum);
        Assert.Equal(new List<string> { "teleport=10,20,30", "input:TurnOn=" }, entity.Verbs);
        Assert.Equal(10, _engine.Evaluate("entity.position.x"));
    }

    [Fact]
    public void AsGivesTheSurfaceForANamedSchemaClass()
    {
        var entity = _world.Spawn(42);
        var facade = _world.For(entity)!;

        var raw = facade.As("FakeEntity");
        Assert.IsType<FakeEntityRaw>(raw);

        // It reads through the same resolver the facade holds — a real live surface, not
        // a snapshot.
        entity.TeamNum = 7;
        Assert.Equal(7, ((FakeEntityRaw)raw).TeamNum);
    }

    [Fact]
    public void AsRefusesANameTheGameDoesNotBind()
    {
        var facade = _world.For(_world.Spawn(42))!;

        // The one check it makes: the same one unsafe makes on its class argument.
        Assert.Throws<ArgumentException>(() => facade.As("CNotAThing"));
    }

    [Fact]
    public void AsResolvesNothingUntilTheSurfaceIsRead()
    {
        var facade = _world.For(_world.Spawn(42))!;
        var raw = facade.As("FakeEntity");

        _world.Destroy(42);

        // The call did not touch the entity, so it did not throw. The read does.
        Assert.Throws<DeadEntityException>(() => ((FakeEntityRaw)raw).TeamNum);
    }

    [Fact]
    public void ScriptCanCatchWhatADeadEntityThrows()
    {
        _engine.AddHostObject("entity", _world.For(_world.Spawn(42))!);
        _world.Destroy(42);

        var caught = _engine.Evaluate(
            """
            (() => {
                try {
                    entity.remove();
                } catch (e) {
                    return `${e instanceof Error} ${e.message}`;
                }
            })()
            """);

        Assert.Equal("true entity 42 is no longer in the game", caught);
    }
}
