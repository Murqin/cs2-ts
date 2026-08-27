using System.Runtime.InteropServices;
using CounterStrikeSharp.API.Core;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Spike;

/// <summary>
/// Phase 0, step 0: can a second V8 live in the CS2 server process at all?
///
/// This deliberately measures nothing about the C# to JavaScript boundary. If two V8
/// builds cannot coexist there is no boundary left to measure, so this runs first and
/// on its own.
///
/// Set CS2TS_DEEPBIND=1 to take the RTLD_DEEPBIND path; leave it unset for the
/// unmitigated control run. Both runs write to the same log so they can be diffed.
/// </summary>
public sealed class SpikePlugin : BasePlugin
{
    public override string ModuleName => "CS2-TS Spike";
    public override string ModuleVersion => "0.0.1";
    public override string ModuleAuthor => "Icarus Murqin";
    public override string ModuleDescription => "Phase 0 step 0: V8 coexistence probe.";

    private V8ScriptEngine? _engine;

    public override void Load(bool hotReload)
    {
        var useDeepBind = Environment.GetEnvironmentVariable("CS2TS_DEEPBIND") == "1";
        var mode = useDeepBind ? "deepbind" : "plain";

        SpikeLog.Open(Path.Combine(Path.GetTempPath(), $"cs2ts-spike-{mode}.log"));
        SpikeLog.Write($"mode={mode} hotReload={hotReload}");
        SpikeLog.Write($"valve v8 mapped: {ValveV8Modules()}");

        try
        {
            Probe(useDeepBind);
        }
        catch (Exception ex)
        {
            // A managed exception here is the good outcome: the process survived and
            // named the problem. A symbol collision is far more likely to be a SIGSEGV,
            // which never reaches this handler.
            SpikeLog.Write($"FAILED (managed exception) {ex.GetType().Name}: {ex.Message}");
        }
    }

    private void Probe(bool useDeepBind)
    {
        SpikeLog.Write($"plugin dir={ModuleDirectory}");
        SpikeLog.Write($"clearscript asm={typeof(V8ScriptEngine).Assembly.Location}");
        SpikeLog.Write($"appdomain base={AppDomain.CurrentDomain.BaseDirectory}");

        var temps = V8Preload.TempCopies().ToArray();
        SpikeLog.Write($"temp copies before load: {(temps.Length == 0 ? "none" : string.Join(", ", temps))}");

        var candidates = V8Preload.CandidatePaths(ModuleDirectory).Distinct().Where(File.Exists).ToArray();
        if (candidates.Length == 0)
        {
            SpikeLog.Write("FAILED native library not found on any candidate path");
            return;
        }

        SpikeLog.Write($"candidates={string.Join(", ", candidates)}");

        if (useDeepBind)
        {
            var soPath = candidates[0];
            SpikeLog.Write($"step 1/6 dlopen RTLD_NOW|RTLD_DEEPBIND {soPath} ...");
            var handle = V8Preload.LoadDeepBind(soPath, out var error);
            if (handle == IntPtr.Zero)
            {
                SpikeLog.Write($"FAILED dlopen: {error}");
                return;
            }

            SpikeLog.Write($"step 1/6 ok handle=0x{handle.ToInt64():x}");

            // ClearScript reaches the native library through P/Invoke, and P/Invoke
            // resolution runs through the load context. Left alone, the host answers
            // it by copying the library to a temp directory and loading that copy —
            // a different file, so the DEEPBIND flags above would not apply to it.
            // Answering the resolution ourselves is what makes the preload count.
            NativeLibrary.SetDllImportResolver(typeof(V8ScriptEngine).Assembly, (name, _, _) =>
            {
                var claimed = name.Contains("ClearScriptV8", StringComparison.Ordinal);
                SpikeLog.Write($"resolver: {name} -> {(claimed ? "deepbind handle" : "default")}");
                return claimed ? handle : IntPtr.Zero;
            });

            SpikeLog.Write("step 1/6 resolver installed");
        }
        else
        {
            SpikeLog.Write("step 1/6 skipped (no preload, control run)");
        }

        SpikeLog.Write("step 2/6 constructing V8ScriptEngine ...");
        _engine = new V8ScriptEngine("cs2ts-spike");
        SpikeLog.Write("step 2/6 ok");

        SpikeLog.Write("step 3/6 evaluating 1+1 ...");
        var sum = _engine.Evaluate("1 + 1");
        SpikeLog.Write($"step 3/6 ok result={sum}");

        // A first expression only proves the engine initialised. Compilation, the
        // garbage collector and the platform's worker threads are separate code paths,
        // and those are where a mismatched V8 is most likely to reach for a structure
        // laid out by the other build.
        SpikeLog.Write("step 4/6 allocating to force a V8 garbage collection ...");
        var live = _engine.Evaluate(
            """
            let sink = 0;
            for (let round = 0; round < 40; round++) {
                const held = [];
                for (let i = 0; i < 50000; i++) {
                    held.push({ i, tag: 'cs2ts' + i, nested: { value: i * 2 } });
                }
                sink += held.length;
            }
            sink;
            """);
        SpikeLog.Write($"step 4/6 ok allocated={live}");

        SpikeLog.Write("step 5/6 CollectGarbage(true) ...");
        _engine.CollectGarbage(true);
        SpikeLog.Write("step 5/6 ok");

        // Teardown and a second engine exercise isolate disposal, which is where a
        // corrupted heap tends to surface if it has not already.
        SpikeLog.Write("step 6/6 dispose and recreate ...");
        _engine.Dispose();
        _engine = new V8ScriptEngine("cs2ts-spike-2");
        var second = _engine.Evaluate("[1,2,3].map(n => n * 3).join(',')");
        SpikeLog.Write($"step 6/6 ok second={second}");

        SpikeLog.Write("SUCCESS all steps passed");
    }

    private static string ValveV8Modules()
    {
        try
        {
            var names = File.ReadLines("/proc/self/maps")
                .Where(line => line.Contains("libv8", StringComparison.Ordinal))
                .Select(line => Path.GetFileName(line[(line.LastIndexOf(' ') + 1)..]))
                .Distinct()
                .Order()
                .ToArray();

            return names.Length == 0 ? "none" : string.Join(' ', names);
        }
        catch (Exception ex)
        {
            return $"unreadable ({ex.GetType().Name})";
        }
    }

    public override void Unload(bool hotReload)
    {
        _engine?.Dispose();
        _engine = null;
    }
}
