using System.Linq;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using Microsoft.ClearScript.V8;
using Cs2Ts.Runtime;

namespace Cs2Ts.Spike;

/// <summary>
/// Phase 0 probe. Step 0 asks whether a second V8 can live in the CS2 server process
/// at all; step 1 measures what one crossing of the C# / JavaScript boundary costs.
/// Step 0 runs first and unconditionally, because a failure there leaves nothing to
/// measure.
///
/// Set CS2TS_NO_DEEPBIND=1 for the unmitigated control run, which is expected to abort
/// the server inside Valve's V8. The mitigation is on by default: it is a precondition
/// for the process surviving, not a tuning option.
/// </summary>
public sealed class SpikePlugin : BasePlugin
{
    public override string ModuleName => "CS2-TS Spike";
    public override string ModuleVersion => "0.0.2";
    public override string ModuleAuthor => "Icarus Murqin";
    public override string ModuleDescription => "Phase 0: V8 coexistence probe and boundary benchmark.";

    private V8ScriptEngine? _engine;

    public override void Load(bool hotReload)
    {
        var control = Environment.GetEnvironmentVariable("CS2TS_NO_DEEPBIND") == "1";
        var noV8 = Environment.GetEnvironmentVariable("CS2TS_NO_V8") == "1";
        var mode = noV8 ? "baseline" : control ? "control" : "deepbind";

        SpikeLog.Open(Path.Combine(Path.GetTempPath(), $"cs2ts-spike-{mode}.log"));
        SpikeLog.Write($"mode={mode} hotReload={hotReload}");
        SpikeLog.Write($"valve v8 mapped: {ValveV8Modules()}");

        try
        {
            PrepareServer();
            ScheduleBotFill();

            if (noV8)
            {
                // The CounterStrikeSharp baseline: this plugin is loaded and ticking,
                // but no V8 exists in the process beyond Valve's own. Everything the
                // loaded run does on top of this is what the scripting layer costs.
                SpikeLog.Write("no-V8 baseline run: skipping every ClearScript path");
                ScheduleFrametimeBench(null);
                return;
            }

            if (!control && !V8Bootstrap.Install(ModuleDirectory, SpikeLog.Write))
            {
                return;
            }

            Coexistence();
            ScheduleBoundaryBench();
        }
        catch (Exception ex)
        {
            // A managed exception is the good outcome: the process survived and named
            // the problem. A symbol collision is a SIGABRT, which never gets here.
            SpikeLog.Write($"FAILED (managed exception) {ex.GetType().Name}: {ex.Message}");
        }
    }

    private void Coexistence()
    {
        SpikeLog.Write("step 0: constructing V8ScriptEngine ...");
        _engine = new V8ScriptEngine("cs2ts-spike");
        SpikeLog.Write($"step 0: 1+1 = {_engine.Evaluate("1 + 1")}");

        // A first expression only proves the engine initialised. Compilation and
        // garbage collection are separate code paths, and those are where a
        // mismatched V8 reaches for a structure laid out by the other build.
        var allocated = _engine.Evaluate(
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
        _engine.CollectGarbage(true);
        SpikeLog.Write($"step 0: allocated={allocated}, collected, engine alive");
    }

    /// <summary>
    /// An empty CS2 server hibernates, which stops the game loop: timers never fire and
    /// there are no entities to measure. Bots solve both at once — they run the loop and
    /// they carry real controllers and pawns.
    /// </summary>
    private static void PrepareServer()
    {
        string[] setup =
        [
            "sv_hibernate_when_empty 0",
            "bot_join_after_player 0",
            "mp_limitteams 0",
            "mp_autoteambalance 0",
            "bot_quota_mode fill",
            "bot_quota 10",
            "mp_warmup_end",
        ];

        foreach (var command in setup)
        {
            Server.ExecuteCommand(command);
        }

        SpikeLog.Write($"server prepared: {string.Join("; ", setup)}");
    }

    /// <summary>
    /// The bot quota does not stick when it is set during plugin load: the game rules
    /// are not up yet and only a couple of bots ever join. Re-issuing it once the map
    /// is running is what actually fills the server.
    /// </summary>
    private void ScheduleBotFill()
    {
        AddTimer(8.0f, () =>
        {
            Server.ExecuteCommand("bot_quota_mode fill");
            Server.ExecuteCommand("bot_quota 10");
            SpikeLog.Write("bot quota re-issued");
        });
    }

    private void ScheduleFrametimeBench(Action? perTickWork)
    {
        // Sixty seconds at 64 tick. Long enough for a major collection to land, which
        // is the event this benchmark exists to catch.
        AddTimer(30.0f, () =>
        {
            SpikeLog.Write($"players at frametime start: {Utilities.GetPlayers().Count(p => p.IsValid)}");
            new FrametimeBench(this, SpikeLog.Write, ticks: 3840, perTickWork).Start();
        });

        SpikeLog.Write("frametime benchmark scheduled for T+30s");
    }

    private void ScheduleBoundaryBench()
    {
        // Benchmarks belong on the game thread, and not during map load: measuring
        // while the server is still spawning entities reports startup contention
        // rather than steady-state cost.
        AddTimer(25.0f, () =>
        {
            if (_engine is null)
            {
                return;
            }

            SpikeLog.Write("");
            SpikeLog.Write("=== step 1: boundary benchmark (game thread) ===");
            try
            {
                BoundaryBench.Run(_engine, SpikeLog.Write, iterations: 50_000, warmup: 20_000);
                var userIds = EntityBench.Run(_engine, SpikeLog.Write, iterations: 20_000, warmup: 5_000);

                // 640 ticks is ten seconds at 64 tick: long enough for a tail, short
                // enough that the run finishes without supervision.
                new TickBench(this, _engine, SpikeLog.Write, ticks: 640).Start(userIds);

                // The loaded half of the frametime comparison: the same per-tick script
                // work a real handler would do, so the distribution reflects the cost
                // rather than an idle engine.
                var readHealth = (Microsoft.ClearScript.ScriptObject)_engine.Script.tickRead;
                var id = userIds.Length > 0 ? userIds[0] : 0;
                AddTimer(15.0f, () => ScheduleFrametimeBench(() => readHealth.InvokeAsFunction(id)));
            }
            catch (Exception ex)
            {
                SpikeLog.Write($"bench FAILED {ex.GetType().Name}: {ex.Message}");
            }
        });

        SpikeLog.Write("boundary benchmark scheduled for T+25s on the game thread");
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
