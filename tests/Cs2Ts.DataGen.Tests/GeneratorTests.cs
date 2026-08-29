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
    private static readonly SchemaSurface Pawn = Surfaces.Read("PawnRaw", typeof(CCSPlayerPawn));
    private static readonly SchemaSurface Controller = Surfaces.Read("ControllerRaw", typeof(CCSPlayerController));

    [Fact]
    public void TheCheckedInFilesAreWhatTheGeneratorWritesToday()
    {
        var root = Repository.Root();

        foreach (var surface in new[] { Pawn, Controller })
        {
            var path = Path.Combine(root, "src", "Cs2Ts.Plugin", "Generated", $"{surface.Name}.g.cs");
            Assert.True(File.Exists(path), $"{path} is missing; run 'dotnet run --project tools/datagen'");
            Assert.Equal(Emit.CSharp(surface), File.ReadAllText(path));
        }

        // The declarations are spliced into a hand-written file, so the check is that
        // writing the region again changes nothing.
        var declarations = File.ReadAllText(Path.Combine(root, "templates", "cs2ts.d.ts"));
        Assert.Equal(
            declarations,
            Region.Replace(declarations, string.Join("\n", new[] { Pawn, Controller }.Select(Emit.TypeScript))));
    }

    [Fact]
    public void OnlyThreeKindsOfValueCrossTheBoundary()
    {
        // A number, a boolean and a string. Anything else either has no honest
        // JavaScript form or is an object of its own, and arriving half-right is worse
        // than not arriving: the escape hatch already hands script a schema field as an
        // object with nothing on it, and this surface exists because that is useless.
        var kinds = Pawn.Fields.Concat(Controller.Fields).Select(field => field.TypeScriptType).ToHashSet();

        Assert.Equal(["boolean", "number", "string"], kinds.Order());
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
        var field = Field(Pawn, "moveType");

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
        foreach (var surface in new[] { Pawn, Controller })
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
        // that no longer compiles its script.
        foreach (var name in new[] { "health", "armorValue", "isScoped", "velocityModifier", "lastPlaceName" })
        {
            Assert.NotNull(Field(Pawn, name));
        }

        foreach (var name in new[] { "score", "ping", "playerName" })
        {
            Assert.NotNull(Field(Controller, name));
        }
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

    private static SchemaField Field(SchemaSurface surface, string scriptName) =>
        surface.Fields.SingleOrDefault(field => field.ScriptName == scriptName)
        ?? throw new InvalidOperationException($"{surface.Name} has no '{scriptName}'");
}
