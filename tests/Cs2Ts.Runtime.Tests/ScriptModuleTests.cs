using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// A plugin split across files.
///
/// Until now a plugin was one file, and the shipped tsconfig said otherwise: it accepts
/// an import of a sibling by its .ts path, so a script could type-check on the author's
/// machine and then fail to load with "Cannot use import statement outside a module".
/// That is the class of mistake the tsconfig exists to prevent, made by the tsconfig.
///
/// The folder is what closes it, and the folder is also the boundary. What a plugin can
/// import is what is inside it — so it can be handed to somebody else as an archive and
/// still work, and so that deleting one plugin cannot break another.
/// </summary>
public sealed class ScriptModuleTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("cs2ts-modules-").FullName;
    private readonly List<ScriptError> _errors = [];
    private readonly List<string> _logged = [];
    private readonly ScriptHost _host;

    public ScriptModuleTests()
    {
        _host = new ScriptHost(_errors.Add);
        _host.Configure = (_, engine) => engine.AddHostObject("console", new Log(_logged));
    }

    public void Dispose()
    {
        _host.Dispose();
        Directory.Delete(_root, recursive: true);
    }

    [DefaultScriptUsage(ScriptAccess.None)]
    public sealed class Log(List<string> lines)
    {
        [ScriptMember("log")]
        public void Write(object? value) => lines.Add(value?.ToString() ?? "null");
    }

    private void Write(string relative, string contents)
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, contents);
    }

    /// <summary>Discovers and loads whatever is on disk, the way the binding does.</summary>
    private PluginLoadResult Load(string name)
    {
        var source = PluginDiscovery.Find(_root, _logged.Add).Single(plugin => plugin.Name == name);
        return _host.Load(source, File.ReadAllText(source.EntryPath));
    }

    [Fact]
    public void AFolderPluginImportsItsOwnFiles()
    {
        Write("jetpack/physics.ts", "export const boost: number = 21;\n");
        Write("jetpack/index.ts",
            "import { boost } from './physics.ts';\nconsole.log(`boost ${boost * 2}`);\n");

        var result = Load("jetpack");

        Assert.True(result.Succeeded, string.Join(" | ", result.Report()));
        Assert.Contains("boost 42", _logged);

        // The module was stripped on the way in: without that, V8 would have been handed
        // `export const boost: number = 21` and refused it.
        Assert.Empty(_errors);
    }

    [Fact]
    public void ModulesCanBeNestedAndImportEachOther()
    {
        Write("jetpack/deep/vector.ts", "export const up: number = 3;\n");
        Write("jetpack/deep/index.ts",
            "import { up } from './vector.ts';\nexport const lift = (n: number): number => n * up;\n");
        Write("jetpack/index.ts",
            "import { lift } from './deep/index.ts';\nconsole.log(`lift ${lift(4)}`);\n");

        Assert.True(Load("jetpack").Succeeded);
        Assert.Contains("lift 12", _logged);
    }

    /// <summary>
    /// The specifiers here are the ones the shipped tsconfig accepts, and matching it
    /// exactly is the point rather than generosity. Anything the compiler resolves and
    /// this does not would be a script that type-checks and will not load, which is the
    /// inconsistency this whole step exists to close, one layer down.
    /// </summary>
    [Theory]
    [InlineData("./physics.ts")]
    [InlineData("./physics")]
    [InlineData("./physics.js")]
    [InlineData("./deep")]
    public void TheSpecifiersTheCompilerAcceptsAllResolve(string specifier)
    {
        Write("jetpack/physics.ts", "export const boost: number = 21;\n");
        Write("jetpack/deep/index.ts", "export const boost: number = 21;\n");
        Write("jetpack/index.ts",
            $"import {{ boost }} from '{specifier}';\nconsole.log(`boost ${{boost}}`);\n");

        Assert.True(Load("jetpack").Succeeded, string.Join("; ", _logged));
        Assert.Contains("boost 21", _logged);
    }

    [Fact]
    public void APluginCannotReachOutsideItsOwnFolder()
    {
        Write("surf/index.ts", "export const secret: number = 1;\n");
        Write("surf/internals.ts", "export const secret: number = 1;\n");
        Write("jetpack/index.ts", "import { secret } from '../surf/internals.ts';\n");

        var result = Load("jetpack");

        Assert.False(result.Succeeded);
        var report = string.Join("\n", result.Report());
        Assert.Contains("outside its own folder", report, StringComparison.Ordinal);
    }

    [Fact]
    public void ASingleFilePluginIsToldHowToBecomeAFolder()
    {
        Write("physics.ts", "export const boost: number = 21;\n");
        Write("welcome.ts", "import { boost } from './physics.ts';\n");

        var result = Load("welcome");

        Assert.False(result.Succeeded);
        var report = string.Join("\n", result.Report());

        // physics.ts is a plugin of its own, not a module, which is exactly why this
        // cannot work — and why the message is an instruction rather than a refusal.
        Assert.Contains("single file", report, StringComparison.Ordinal);
        Assert.Contains("folder called 'welcome'", report, StringComparison.Ordinal);
    }

    [Fact]
    public void APackageImportSaysThatItIsAPackage()
    {
        Write("jetpack/index.ts", "import { chunk } from 'lodash';\n");

        var result = Load("jetpack");

        Assert.False(result.Succeeded);
        var report = string.Join("\n", result.Report());

        // Worth its own sentence: the compiler resolves types out of node_modules
        // whether or not anything can run them, so this is a line the author's editor
        // was perfectly happy with.
        Assert.Contains("package", report, StringComparison.Ordinal);
        Assert.Contains("lodash", report, StringComparison.Ordinal);
    }

    [Fact]
    public void AMissingModuleNamesWhatWasAskedFor()
    {
        Write("jetpack/index.ts", "import { boost } from './physics.ts';\n");

        var result = Load("jetpack");

        Assert.False(result.Succeeded);
        Assert.Contains("./physics.ts", string.Join("\n", result.Report()), StringComparison.Ordinal);
    }

    /// <summary>
    /// A mistake inside an imported module has to be reported in that module, with its
    /// line. It cannot be caught: what comes out of Execute is a ScriptEngineException
    /// with the loader's own exception type gone, so the diagnostics are collected on
    /// the way past and read afterwards.
    /// </summary>
    [Fact]
    public void AModuleThatWillNotCompileIsReportedInItsOwnFile()
    {
        Write("jetpack/physics.ts", "enum Direction { Up, Down }\nexport const up = Direction.Up;\n");
        Write("jetpack/index.ts", "import { up } from './physics.ts';\n");

        var result = Load("jetpack");

        Assert.False(result.Succeeded);
        var report = string.Join("\n", result.Report());

        // The author's file and the author's line, not the entry point's.
        Assert.Contains("physics.ts(1,1)", report, StringComparison.Ordinal);
        Assert.Contains("CS2TS_ENUM", report, StringComparison.Ordinal);
    }

    [Fact]
    public void AThrowInsideAModuleNamesTheModule()
    {
        Write("jetpack/physics.ts", "export function boost(): number {\n    throw new Error('physics blew up');\n}\n");
        Write("jetpack/index.ts", "import { boost } from './physics.ts';\non('tick', () => boost());\n");

        Assert.True(Load("jetpack").Succeeded);

        // Nothing completed: the handler threw, which is what is being tested.
        Assert.Equal(0, _host.Dispatch("tick"));

        var error = Assert.Single(_errors);
        Assert.Contains("physics blew up", error.Message, StringComparison.Ordinal);
        Assert.Contains("physics.ts", error.ToString(), StringComparison.Ordinal);
    }

    /// <summary>
    /// Two plugins whose entry points are both called index.ts. The name a frame carries
    /// has to say which one, or a server running five folder plugins reports five
    /// different mistakes under one file name.
    /// </summary>
    [Fact]
    public void TwoIndexFilesStayTellableApart()
    {
        Write("jetpack/index.ts", "on('tick', () => { throw new Error('from jetpack'); });\n");
        Write("surf/index.ts", "on('tick', () => { throw new Error('from surf'); });\n");

        Assert.True(Load("jetpack").Succeeded);
        Assert.True(Load("surf").Succeeded);
        _host.Dispatch("tick");

        Assert.Equal(2, _errors.Count);
        Assert.Contains(_errors, error => error.ToString().Contains("jetpack/index.ts", StringComparison.Ordinal));
        Assert.Contains(_errors, error => error.ToString().Contains("surf/index.ts", StringComparison.Ordinal));
    }

    /// <summary>
    /// Loading the same plugin three times, which is what saving a file twice does.
    ///
    /// The regression this guards is a real one from the single-file days: the shared
    /// runtime's document store renamed a document it had already seen, so the second
    /// load reported "vip [2].ts" and the third "vip [3].ts". Modules go through that
    /// store too now, and a test that loads once could never see it.
    /// </summary>
    [Fact]
    public void ReloadingDoesNotRenameTheFiles()
    {
        Write("jetpack/physics.ts", "export function boost(): number {\n    throw new Error('physics blew up');\n}\n");
        Write("jetpack/index.ts", "import { boost } from './physics.ts';\non('tick', () => boost());\n");

        for (var load = 0; load < 3; load++)
        {
            _errors.Clear();
            Assert.True(Load("jetpack").Succeeded);
            _host.Dispatch("tick");

            var error = Assert.Single(_errors);
            Assert.DoesNotContain("[2]", error.ToString(), StringComparison.Ordinal);
            Assert.DoesNotContain("[3]", error.ToString(), StringComparison.Ordinal);
            Assert.Contains("physics.ts", error.ToString(), StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// A module is loaded once per plugin, not once per import. It is also loaded once
    /// per plugin rather than once per server: two plugins importing the same file name
    /// get their own copy, which is what keeps one plugin's state out of another's.
    /// </summary>
    [Fact]
    public void AModuleRunsOncePerPluginHoweverOftenItIsImported()
    {
        Write("jetpack/counter.ts", "console.log('counter ran');\nexport const n: number = 1;\n");
        Write("jetpack/other.ts", "import { n } from './counter.ts';\nexport const m: number = n;\n");
        Write("jetpack/index.ts",
            "import { n } from './counter.ts';\nimport { m } from './other.ts';\nconsole.log(`sum ${n + m}`);\n");

        Assert.True(Load("jetpack").Succeeded);

        Assert.Equal(1, _logged.Count(line => line == "counter ran"));
        Assert.Contains("sum 2", _logged);
    }
}
