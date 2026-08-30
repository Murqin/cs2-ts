using CounterStrikeSharp.API.Core;

namespace Cs2Ts.DataGen.Tests;

/// <summary>
/// What the generator decides, and whether the files in the repository still say it.
///
/// Two different jobs. The mapping tests pin choices that were made for a reason — a
/// string field is read-only, a 64-bit field cannot be a number — so that changing one
/// is a deliberate act rather than something a refactor does. The staleness test pins
/// nothing about the surface at all; it fails when CounterStrikeSharp has moved and
/// nobody re-ran the tool, which is the only way the generated code can be wrong while
/// looking right.
/// </summary>
public sealed class GeneratorTests
{
    private static readonly IReadOnlyList<SchemaSurface> AllSurfaces = Surfaces.All();
    private static readonly SchemaSurface Pawn = AllSurfaces.First(surface => surface.Name == "PawnRaw");
    private static readonly SchemaSurface Controller = AllSurfaces.First(surface => surface.Name == "ControllerRaw");
    private static readonly IReadOnlyList<EventSurface> GameEvents = Events.Read(typeof(CCSPlayerPawn).Assembly);

    [Fact]
    public void TheCheckedInFilesAreWhatTheGeneratorWritesToday()
    {
        var root = Repository.Root();

        var surfaces = Path.Combine(root, "src", "Cs2Ts.Plugin", "Generated", "EntitySurfaces.g.cs");
        Assert.True(File.Exists(surfaces), $"{surfaces} is missing; run 'dotnet run --project tools/datagen'");
        Assert.Equal(Emit.CSharpFile(AllSurfaces), File.ReadAllText(surfaces));

        var factory = Path.Combine(root, "src", "Cs2Ts.Plugin", "Generated", "EntitySurfaces.Factory.g.cs");
        Assert.True(File.Exists(factory), $"{factory} is missing; run 'dotnet run --project tools/datagen'");
        Assert.Equal(Emit.CSharpFactory(AllSurfaces), File.ReadAllText(factory));

        var events = Path.Combine(root, "src", "Cs2Ts.Plugin", "Generated", "GameEvents.g.cs");
        Assert.True(File.Exists(events), $"{events} is missing; run 'dotnet run --project tools/datagen'");
        Assert.Equal(Emit.CSharpEvents(GameEvents), File.ReadAllText(events));

        // The declarations are spliced into a hand-written file, so the check is that
        // writing the region again changes nothing.
        var declarations = File.ReadAllText(Path.Combine(root, "templates", "cs2ts.d.ts"));
        Assert.Equal(
            declarations,
            Region.Replace(declarations, string.Join("\n", [
                .. AllSurfaces.Select(Emit.TypeScript),
                Emit.TypeScriptSchemaClasses(AllSurfaces),
                Emit.TypeScriptEvents(GameEvents),
            ])));
    }

    [Fact]
    public void OnlyThreeKindsOfValueAndOneKindOfReferenceCrossTheBoundary()
    {
        // A number, a boolean and a string. Anything else either has no honest
        // JavaScript form or is an object of its own, and arriving half-right is worse
        // than not arriving: the escape hatch already hands script a schema field as an
        // object with nothing on it, and this surface exists because that is useless.
        //
        // The fourth is not a value. A field holding another entity stores a handle,
        // which is the identity these objects are already keyed by, so it can arrive as
        // the entity itself rather than as a number to go and look up.
        var kinds = AllSurfaces.SelectMany(surface => surface.Fields)
            .Select(field => field.TypeScriptType)
            .ToHashSet();

        Assert.Equal(["boolean", "Entity<EntityRaw> | null", "number", "string"], kinds.Order());
    }

    [Fact]
    public void AFieldHoldingAnotherEntityArrivesAsOne()
    {
        // The controller's own pointer to the pawn. It was one of the eleven fields the
        // generator used to leave out, and it is the one that shows what carrying them
        // buys: the body is reachable from the controller without going through the
        // player at all.
        var field = Field(Controller, "playerPawn");

        Assert.Equal("EntityFacade?", field.CSharpType);
        Assert.Equal("Entity<EntityRaw> | null", field.TypeScriptType);

        // Read through the one table, so the same entity reached two ways is one object.
        Assert.Equal("_entities.ForHandle({0}.Raw)", field.ReadFormat);

        // Read-only, and deliberately: what writing one of these means varies per field,
        // and a wrong one is an entity pointing at the wrong owner rather than a value
        // that looks odd.
        Assert.Null(field.WriteFormat);
    }

    [Fact]
    public void AStringFieldIsReadOnly()
    {
        var field = Field(Pawn, "lastPlaceName");

        // Not a limitation of this tool. CounterStrikeSharp's getter reads characters
        // from the field's own address and its setter writes an eight-byte pointer
        // there, so for every field where reading works, writing would overwrite the
        // first eight characters and report nothing.
        Assert.Equal("string", field.TypeScriptType);
        Assert.Null(field.WriteFormat);
    }

    [Fact]
    public void A64BitFieldArrivesAsAStringAndIsNotWritten()
    {
        var field = Field(Controller, "playerDominated");

        // Above 2^53 a JavaScript number rounds, and the value it rounds to is a
        // different one. A string says so; a number would be quietly wrong, which is
        // the same reasoning that made steamId a string on the curated surface.
        Assert.Equal("string", field.TypeScriptType);
        Assert.Contains("ToString(CultureInfo.InvariantCulture)", field.ReadFormat, StringComparison.Ordinal);
        Assert.Null(field.WriteFormat);
    }

    [Fact]
    public void AnEnumArrivesAsANumberInBothDirections()
    {
        // moveType is CBaseEntity's, so it lands on the root surface now rather than on
        // the pawn — which is the point of the tree: a field sits on the class that
        // declares it and every entity inherits it.
        var field = Field("moveType");

        // A host enum crosses into script as an object. What an author wants is the
        // value they can compare and write back, so it is cast on the way out and back
        // on the way in.
        Assert.Equal("number", field.TypeScriptType);
        Assert.Equal("int", field.CSharpType);
        Assert.Equal("(int){0}", field.ReadFormat);
        Assert.Contains("MoveType_t)value", field.WriteFormat!, StringComparison.Ordinal);
    }

    [Fact]
    public void AFloatIsNarrowedWhereTheReasonForItIs()
    {
        var field = Field(Pawn, "velocityModifier");

        // Script only has doubles and the game works in floats. The narrowing is in the
        // generated setter rather than somewhere it would look like a bug.
        Assert.Equal("double", field.CSharpType);
        Assert.Equal("(float)value", field.WriteFormat);
    }

    [Fact]
    public void EveryWriteReplicates()
    {
        foreach (var surface in AllSurfaces)
        {
            var emitted = Emit.CSharp(surface);
            var writable = surface.Fields.Where(field => field.WriteFormat is not null).ToList();

            // The count, not just the presence: a setter that wrote the field and
            // skipped the notification would still contain the word, somewhere else.
            Assert.Equal(
                writable.Count,
                emitted.Split("SchemaWrite.Replicate(", StringSplitOptions.None).Length - 1);

            foreach (var field in writable)
            {
                Assert.Contains(
                    $"SchemaWrite.Replicate(entity, \"{field.ClassName}\", \"{field.FieldName}\"",
                    emitted,
                    StringComparison.Ordinal);
            }
        }
    }

    [Fact]
    public void TheFieldsTheRestOfTheSuiteUsesAreStillHere()
    {
        // A CounterStrikeSharp bump that renamed one of these would otherwise show up as
        // a declaration test failing in another repository language, or as a server test
        // that no longer compiles its script. Searched across every surface, because the
        // tree moved some of them off the pawn onto the class that declares them —
        // health and lastPlaceName are CBaseEntity's.
        foreach (var name in new[] { "health", "armorValue", "isScoped", "velocityModifier", "lastPlaceName" })
        {
            Assert.NotNull(Field(name));
        }

        foreach (var name in new[] { "score", "ping", "playerName" })
        {
            Assert.NotNull(Field(name));
        }
    }

    [Fact]
    public void EverySurfaceButTheRootDerivesFromAGeneratedOne()
    {
        var root = AllSurfaces.Single(surface => surface.Name == "EntityRaw");
        Assert.Null(root.BaseName);
        Assert.Equal("CBaseEntity", root.Entity.Name);

        var names = AllSurfaces.Select(surface => surface.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var surface in AllSurfaces.Where(surface => surface.BaseName is not null))
        {
            // The base is another surface in the set, and it is the surface for this
            // class's own base class.
            Assert.Contains(surface.BaseName!, names);
            Assert.Equal(Surfaces.NameFor(surface.Entity.BaseType!), surface.BaseName);
        }
    }

    [Fact]
    public void TheTreeReachesTheRootFromEveryLeaf()
    {
        var byName = AllSurfaces.ToDictionary(surface => surface.Name, StringComparer.Ordinal);

        foreach (var surface in AllSurfaces)
        {
            var steps = 0;
            for (var current = surface; current.BaseName is not null; current = byName[current.BaseName])
            {
                Assert.True(++steps < 32, $"{surface.Name} does not reach the root");
            }
        }
    }

    [Fact]
    public void AFieldSitsOnTheClassThatDeclaresItAndIsInheritedElsewhere()
    {
        // health is declared on CBaseEntity, so it is a member of the root surface and of
        // no other — the pawn gets it by inheriting, not by carrying a copy.
        Assert.Contains(Surface("EntityRaw").Fields, field => field.ScriptName == "health");
        Assert.DoesNotContain(Surface("PawnRaw").Fields, field => field.ScriptName == "health");

        // armorValue is the pawn's own.
        Assert.Contains(Surface("PawnRaw").Fields, field => field.ScriptName == "armorValue");
    }

    [Fact]
    public void AShadowedFieldGetsTheNewKeyword()
    {
        // CBasePropDoor rebinds m_hBlocker on its own class; the base already carries a
        // blocker, so the generated property needs `new`.
        var door = Surface("CBasePropDoorRaw");
        var blocker = door.Fields.Single(field => field.ScriptName == "blocker");
        Assert.True(blocker.Shadows);
        Assert.Contains("public new EntityFacade? Blocker", Emit.CSharp(door), StringComparison.Ordinal);
    }

    [Fact]
    public void TheFactoryAndTheDeclarationMapCoverEverySurfaceUnderItsSchemaName()
    {
        var csharp = Emit.CSharpFactory(AllSurfaces);
        var declarations = Emit.TypeScriptSchemaClasses(AllSurfaces);

        foreach (var surface in AllSurfaces)
        {
            // Keyed by the schema class name — what a script types — not the surface name.
            Assert.Contains($"[\"{surface.Entity.Name}\"] = ", csharp, StringComparison.Ordinal);
            Assert.Contains($"\"{surface.Entity.Name}\": {surface.Name};", declarations, StringComparison.Ordinal);
        }

        // The root goes straight through; every other surface re-wraps the generic
        // resolver as its own type before constructing.
        Assert.Contains("[\"CBaseEntity\"] = (resolve, entities) => new EntityRaw(resolve, entities),",
            csharp, StringComparison.Ordinal);
        Assert.Contains(
            "[\"CAK47\"] = (resolve, entities) => new CAK47Raw(() => new global::CounterStrikeSharp.API.Core.CAK47(resolve().Handle), entities),",
            csharp, StringComparison.Ordinal);
    }

    [Fact]
    public void AnIncompatibleShadowFlattensOnlyThatInterface()
    {
        // CInstancedSceneEntity's m_hTarget is a handle where CBaseEntity's m_target is a
        // string, and both camelCase to target. TypeScript will not narrow a member to an
        // unassignable type, so that one interface is written flat — with every inherited
        // field — while the C# class stays in the tree.
        var flat = AllSurfaces.Where(surface => surface.Flat).ToList();
        Assert.NotEmpty(flat);
        Assert.All(flat, surface => Assert.NotEmpty(surface.AllFields));
        Assert.Contains(flat, surface => surface.Name == "CInstancedSceneEntityRaw");

        var ts = Emit.TypeScript(Surface("CInstancedSceneEntityRaw"));
        Assert.DoesNotContain(" extends ", ts, StringComparison.Ordinal);
        Assert.Contains("target: Entity<EntityRaw> | null", ts, StringComparison.Ordinal);
    }

    [Fact]
    public void NothingIsNamedTwice()
    {
        // Surfaces.Read throws rather than picking one, so this only has to prove the
        // two real surfaces come back at all — but it names the reason, which is that an
        // author reaching a field would have no way to say which one they got.
        var names = Pawn.Fields.Select(field => field.ScriptName).ToList();

        Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());
        Assert.All(names, name => Assert.True(char.IsLower(name[0]), name));
    }


    [Fact]
    public void AnEventIsNamedByItsAttributeAndNotByItsClass()
    {
        // The two do not agree in the way a rule would predict, and the hand-written
        // list conflated exactly this pair: what it called player_connect was the class
        // for player_connect_full, so scripts were being handed the later moment under
        // the earlier name. Deriving the name from the class would have kept the bug.
        Assert.Equal("EventPlayerConnect", Event("player_connect").Event.Name);
        Assert.Equal("EventPlayerConnectFull", Event("player_connect_full").Event.Name);

        Assert.Contains(Event("player_connect").Fields, field => field.ScriptName == "bot");
        Assert.DoesNotContain(Event("player_connect_full").Fields, field => field.ScriptName == "bot");
    }

    [Fact]
    public void APlayerOnAnEventIsAFacadeAndMayBeNobody()
    {
        var attacker = Field(Event("player_death"), "attacker");

        // A facade rather than the controller CounterStrikeSharp resolved: the
        // controller is alive for the length of the callback, and what an author puts
        // in a timer has to outlive it. Nullable because a kill by the world has no
        // attacker — that is the game, not caution.
        Assert.Equal("Player | null", attacker.TypeScriptType);
        Assert.Equal("PlayerRef?", attacker.CSharpType);
        Assert.Contains("GameEventPlayer.For(", attacker.ReadFormat, StringComparison.Ordinal);
    }

    [Fact]
    public void UseridIsTheOneFieldThatIsRenamed()
    {
        var player = Field(Event("player_death"), "player");

        // Everything else keeps the name the event gives it. This one does not, because
        // the name is a name for a number and the value is not one: CounterStrikeSharp
        // has already turned the id into a player before we see it, and e.userid.health
        // reads as a mistake.
        Assert.Equal("Userid", player.ClrName);
        Assert.DoesNotContain(
            GameEvents.SelectMany(surface => surface.Fields),
            field => field.ScriptName == "userid");

        // And nothing else was quietly renamed along with it.
        Assert.All(
            GameEvents.SelectMany(surface => surface.Fields).Where(field => field.ClrName != "Userid"),
            field => Assert.Equal(char.ToLowerInvariant(field.ClrName[0]) + field.ClrName[1..], field.ScriptName));
    }

    [Fact]
    public void SixtyFourBitsGoOppositeWaysDependingOnTheirSign()
    {
        // Unsigned means an identifier here — a Steam id, a workshop file id — and every
        // bit of it means something, so it becomes a string. Signed means a count, a
        // limit, an entity index or a tick, none of them near 2^53, so it becomes a
        // number. Both were read off the field names rather than assumed.
        var xuid = Field(Event("player_connect"), "xuid");
        Assert.Equal("string", xuid.TypeScriptType);

        var timelimit = Field(Event("round_start"), "timelimit");
        Assert.Equal("number", timelimit.TypeScriptType);

        // And it is widened rather than passed through: ClearScript marshals a 64-bit
        // integer to script as a host object, not a number.
        Assert.Equal("double", timelimit.CSharpType);
        Assert.Equal("(double){0}", timelimit.ReadFormat);
    }

    [Fact]
    public void OnlyFourKindsOfValueReachAScriptFromAnEvent()
    {
        var kinds = GameEvents.SelectMany(surface => surface.Fields)
            .Select(field => field.TypeScriptType)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Equal(["Player | null", "boolean", "number", "string"], kinds.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void EveryEventCanBeHookedAndEachOneOnlyOnce()
    {
        var emitted = Emit.CSharpEvents(GameEvents);

        Assert.Equal(
            GameEvents.Count,
            emitted.Split("        RegisterEventHandler<", StringSplitOptions.None).Length - 1);

        // One method each rather than one body with all of them in it. That is not a
        // style choice: the switch was measured on a server at 890 ms for its first call
        // and three for every one after, which is past the watchdog's budget, and the
        // shape a later refactor might collapse is the one being pinned here.
        Assert.Equal(
            GameEvents.Count,
            emitted.Split("    private void Hook", StringSplitOptions.None).Length - 1);

        foreach (var surface in GameEvents)
        {
            Assert.Contains(
                $"            case \"{surface.GameName}\": Hook{surface.PayloadName}(); return true;",
                emitted,
                StringComparison.Ordinal);

            // The listener check is what keeps a hook that outlived its script from
            // building a snapshot for nobody.
            Assert.Contains(
                $"host.Handles(\"{surface.GameName}\")", emitted, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void AnEventThatCarriesNothingIsStillAnEvent()
    {
        // Sixty-two of them are the fact that something happened. They still get a class
        // and a name, because a handler for one has to be registerable.
        var empty = GameEvents.Where(surface => surface.Fields.Count == 0).ToList();

        Assert.NotEmpty(empty);
        Assert.Contains(empty, surface => surface.GameName == "round_freeze_end");
    }

    private static EventSurface Event(string gameName) =>
        GameEvents.SingleOrDefault(surface => surface.GameName == gameName)
        ?? throw new InvalidOperationException($"no event called '{gameName}'");

    private static EventField Field(EventSurface surface, string scriptName) =>
        surface.Fields.SingleOrDefault(field => field.ScriptName == scriptName)
        ?? throw new InvalidOperationException($"{surface.GameName} has no '{scriptName}'");

    private static SchemaField Field(SchemaSurface surface, string scriptName) =>
        surface.Fields.SingleOrDefault(field => field.ScriptName == scriptName)
        ?? throw new InvalidOperationException($"{surface.Name} has no '{scriptName}'");

    /// <summary>
    /// A field by name as a player reaches it — from the pawn or controller surface or
    /// anywhere they inherit from. A bare name is not unique across all five hundred
    /// classes, but it is along one chain.
    /// </summary>
    private static SchemaField Field(string scriptName)
    {
        var byName = AllSurfaces.ToDictionary(surface => surface.Name, StringComparer.Ordinal);

        foreach (var leaf in new[] { "PawnRaw", "ControllerRaw" })
        {
            for (var current = byName[leaf]; current is not null; current = current.BaseName is { } b ? byName[b] : null)
            {
                if (current.Fields.FirstOrDefault(field => field.ScriptName == scriptName) is { } hit)
                {
                    return hit;
                }
            }
        }

        throw new InvalidOperationException($"no field '{scriptName}' on the pawn or controller chain");
    }

    private static SchemaSurface Surface(string name) =>
        AllSurfaces.SingleOrDefault(surface => surface.Name == name)
        ?? throw new InvalidOperationException($"no surface called '{name}'");
}
