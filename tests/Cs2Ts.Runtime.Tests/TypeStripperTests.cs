using Xunit.Abstractions;
using Cs2Ts.Runtime;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Runtime.Tests;

[Collection(StripperCollection.Name)]
public sealed class TypeStripperTests(StripperFixture fixture, ITestOutputHelper output)
{
    private TypeStripper Stripper => fixture.Stripper;

    [Fact]
    public void ErasesTypesAndKeepsTheJavaScript()
    {
        var result = Stripper.Strip("plugin.ts", "export function hit(n: number): string {\n    return `${n}`;\n}\n");

        Assert.True(result.Succeeded);
        Assert.Contains("export function hit(n", result.JavaScript);
        Assert.DoesNotContain(": number", result.JavaScript);
        Assert.DoesNotContain("string {", result.JavaScript);
    }

    /// <summary>
    /// The reason ts-blank-space was chosen over a compiler: types become spaces, so a
    /// V8 stack trace already points at the right place in the .ts file and the project
    /// never has to ship source maps.
    /// </summary>
    [Fact]
    public void KeepsEveryLineAndColumnInPlace()
    {
        var typescript =
            """
            interface Loadout {
                readonly weapon: string;
            }

            export function equip(player: { give(w: string): void }, loadout: Loadout): void {
                player.give(loadout.weapon);
            }
            """;

        var result = Stripper.Strip("loadout.ts", typescript);

        Assert.True(result.Succeeded);
        var original = typescript.Split('\n');
        var stripped = result.JavaScript!.Split('\n');

        Assert.Equal(original.Length, stripped.Length);
        for (var i = 0; i < original.Length; i++)
        {
            Assert.Equal(original[i].Length, stripped[i].Length);
        }

        // The one line that has to survive intact is the one that still runs.
        Assert.Equal(original[5], stripped[5]);
    }

    [Theory]
    // The four constructs the shipped tsconfig also rejects. Both guards are kept
    // because only one of them is in the author's control.
    [InlineData("enum Team { T, CT }\n", "CS2TS_ENUM", 1, 1)]
    [InlineData("namespace N { export const x = 1; }\n", "CS2TS_NAMESPACE", 1, 1)]
    [InlineData("class A {\n    constructor(private x: number) {}\n}\n", "CS2TS_PARAMETER_PROPERTY", 2, 17)]
    [InlineData("import F = require('./x.ts');\n", "CS2TS_IMPORT_EQUALS", 1, 1)]
    // And the ones only the stripper sees.
    [InlineData("export = 1;\n", "CS2TS_EXPORT_EQUALS", 1, 1)]
    [InlineData("const a = <string>b;\n", "CS2TS_LEGACY_CAST", 1, 11)]
    public void RefusesSyntaxItCannotErase(string source, string code, int line, int column)
    {
        var result = Stripper.Strip("plugin.ts", source);

        Assert.False(result.Succeeded);
        Assert.Null(result.JavaScript);
        var diagnostic = Assert.Single(result.Diagnostics);
        Assert.Equal(code, diagnostic.Code);
        Assert.Equal(line, diagnostic.Line);
        Assert.Equal(column, diagnostic.Column);
    }

    /// <summary>
    /// Decorators slip past every other guard: erasableSyntaxOnly does not flag them
    /// (they are proposed JavaScript, not a TypeScript extension) and ts-blank-space
    /// copies them through. Without this check the author's first sign of trouble is
    /// V8 rejecting the output with "Invalid or unexpected token".
    /// </summary>
    [Fact]
    public void RefusesDecorators()
    {
        var result = Stripper.Strip("plugin.ts", "class Handlers {\n    @on('player_death')\n    died(): void {}\n}\n");

        Assert.False(result.Succeeded);
        var diagnostic = Assert.Single(result.Diagnostics);
        Assert.Equal("CS2TS_DECORATOR", diagnostic.Code);
        Assert.Equal(2, diagnostic.Line);
        Assert.Equal(5, diagnostic.Column);
    }

    /// <summary>
    /// ts-blank-space emits output for a file that does not parse, and that output is
    /// broken somewhere other than the mistake. Reading the parse diagnostics first is
    /// what keeps the reported location pointing at the typo.
    /// </summary>
    [Fact]
    public void ReportsAParseErrorAtTheTypoRatherThanEmittingBrokenOutput()
    {
        var result = Stripper.Strip("plugin.ts", "export function broken(: number {\n    return 1;\n}\n");

        Assert.False(result.Succeeded);
        Assert.Null(result.JavaScript);
        Assert.All(result.Diagnostics, d => Assert.StartsWith("TS", d.Code));

        // A broken file cascades into follow-on diagnostics, the same way tsc reports
        // it. Only the first one is claimed to be at the mistake.
        var first = result.Diagnostics[0];
        Assert.Equal(1, first.Line);
        Assert.Equal(24, first.Column);
    }

    [Fact]
    public void ReportsEveryProblemInOnePass()
    {
        var result = Stripper.Strip("plugin.ts", "enum A { X }\nnamespace B { export const y = 1; }\n");

        Assert.False(result.Succeeded);
        Assert.Equal(2, result.Diagnostics.Count);
        Assert.Equal(["CS2TS_ENUM", "CS2TS_NAMESPACE"], result.Diagnostics.Select(d => d.Code));
    }

    [Fact]
    public void NamesTheFileInTheDiagnosticSoTheAuthorKnowsWhichPluginFailed()
    {
        var result = Stripper.Strip("addons/warmup.ts", "enum Team { T }\n");

        var diagnostic = Assert.Single(result.Diagnostics);
        Assert.Equal("addons/warmup.ts", diagnostic.FileName);
        // tsc's format, so an editor's error matcher finds the file and the position.
        Assert.StartsWith("addons/warmup.ts(1,1): error CS2TS_ENUM: ", diagnostic.ToString());
    }

    [Theory]
    // Erasable in principle, and worth pinning: each of these is a construct an author
    // would reasonably expect to work, and a stripper regression would silently break it.
    [InlineData("declare enum E { A }\n")]
    [InlineData("namespace Types { export type T = number; }\n")]
    [InlineData("abstract class A { abstract fire(): void; }\n")]
    [InlineData("function f(a: string): void;\nfunction f(a: number): void;\nfunction f(a: unknown): void {}\n")]
    [InlineData("const a = { x: 1 } satisfies Record<string, number>;\n")]
    [InlineData("import type { T } from './t.ts';\nimport { type U, v } from './u.ts';\n")]
    [InlineData("class A { declare x: number; override y(): void {} }\n")]
    public void AcceptsErasableSyntax(string source)
    {
        var result = Stripper.Strip("plugin.ts", source);

        Assert.True(result.Succeeded, string.Join("; ", result.Diagnostics.Select(d => d.ToString())));
    }

    /// <summary>
    /// The output is only useful if V8 will actually run it, which is a separate claim
    /// from "the types are gone".
    /// </summary>
    [Fact]
    public void ProducesOutputV8Runs()
    {
        var result = Stripper.Strip(
            "plugin.ts",
            """
            const Team = { T: 2, CT: 3 } as const;
            type Team = (typeof Team)[keyof typeof Team];

            function describe(team: Team): string {
                return team === Team.T ? "T" : "CT";
            }

            describe(Team.CT);
            """);

        Assert.True(result.Succeeded);

        using var engine = fixture.Runtime.CreateScriptEngine("cs2ts-tests-eval");
        Assert.Equal("CT", engine.Evaluate(result.JavaScript!));
    }

    /// <summary>
    /// Stripping happens at plugin load, not per tick, so the number that matters is
    /// whether it is milliseconds rather than seconds. This pins the order of magnitude
    /// so a regression that makes it seconds shows up here rather than on a server.
    /// </summary>
    [Fact]
    public void StripsATypicalPluginInSingleDigitMilliseconds()
    {
        var source = string.Join("\n", Enumerable.Range(0, 200).Select(i =>
            $"export function handler{i}(player: {{ health: number }}, amount: number): number {{\n" +
            $"    return player.health - amount * {i};\n}}\n"));

        // The first call still carries V8's warm-up for the parser's own code paths.
        Stripper.Strip("warmup.ts", source);

        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var result = Stripper.Strip("big.ts", source);
        var elapsed = System.Diagnostics.Stopwatch.GetElapsedTime(started);

        output.WriteLine($"200 handlers ({source.Length / 1024} KB): {elapsed.TotalMilliseconds:F2} ms");
        Assert.True(result.Succeeded);
        Assert.True(elapsed.TotalMilliseconds < 100, $"stripping 200 handlers took {elapsed.TotalMilliseconds:F1} ms");
    }

    /// <summary>
    /// Evaluating three and a half megabytes of parser is the one large cost in this
    /// layer. It is paid once per process while the map is loading, so the bound is
    /// loose; what it guards against is the bundle growing into something that stalls
    /// server start.
    /// </summary>
    [Fact]
    public void LoadsTheParserWellInsideMapLoad()
    {
        var before = GC.GetTotalMemory(forceFullCollection: true);
        using var stripper = TypeStripper.Create(fixture.Runtime);
        var managed = GC.GetTotalMemory(forceFullCollection: true) - before;

        output.WriteLine($"stripper load: {stripper.LoadTime.TotalMilliseconds:F0} ms, managed delta {managed / 1024} KB");
        Assert.InRange(stripper.LoadTime.TotalMilliseconds, 0, 2000);
    }

    [Fact]
    public void DisposedStripperRefusesToBeUsed()
    {
        var stripper = TypeStripper.Create(fixture.Runtime);
        stripper.Dispose();
        stripper.Dispose();

        Assert.Throws<ObjectDisposedException>(() => stripper.Strip("plugin.ts", "const a = 1;\n"));
    }

    /// <summary>
    /// A plugin's engine must not be able to reach the compiler sitting in the same
    /// isolate, or "no Node built-ins" stops being true the moment a script walks it.
    /// </summary>
    [Fact]
    public void PluginEnginesCannotSeeTheStripper()
    {
        using var engine = fixture.Runtime.CreateScriptEngine("cs2ts-tests-isolation");

        Assert.True((bool)engine.Evaluate("typeof globalThis.__cs2ts_strip === 'undefined'"));
        Assert.True((bool)engine.Evaluate("typeof globalThis.ts === 'undefined'"));
    }
}
