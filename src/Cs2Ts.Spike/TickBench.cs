using System.Diagnostics;
using CounterStrikeSharp.API.Core;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Spike;

/// <summary>
/// The same crossing, sampled once per tick instead of in a tight loop.
///
/// A warm loop keeps the call site hot in every cache and lets V8 tier the callback up,
/// which reports the best case the boundary can ever reach. Real handlers fire once per
/// event with a tick of unrelated engine work in between, so the warm number is a floor
/// and this one is closer to the ceiling. If the two disagree, this is the number that
/// decides whether the design fits in a tick.
/// </summary>
internal sealed class TickBench(BasePlugin plugin, V8ScriptEngine engine, Action<string> log, int ticks)
{
    private readonly int _ticks = ticks;
    private const int BurstSize = 10;

    private readonly Samples _dispatch = new("js callback, first of tick", ticks);
    private readonly Samples _read = new("js -> facade -> health, first of tick", ticks);

    // If the per-tick cost is cache residency rather than the crossing itself, it is
    // paid once per tick and not once per call. A handler reading several properties
    // would then cost far less than the first-call figure multiplied out, which changes
    // what the facade has to optimise for.
    private readonly Samples _dispatchRest = new("js callback, later in same tick", ticks * BurstSize);
    private readonly Samples _readRest = new("js -> facade -> health, later in tick", ticks * BurstSize);
    private ScriptObject? _noop;
    private ScriptObject? _readHealth;
    private int[] _userIds = [];
    private int _remaining = ticks;
    private bool _running;

    public void Start(int[] userIds)
    {
        _userIds = userIds;
        engine.Execute("function tickNoop() {} function tickRead(id) { return players.Health(id); }");
        _noop = (ScriptObject)engine.Script.tickNoop;
        _readHealth = (ScriptObject)engine.Script.tickRead;

        _running = true;
        plugin.RegisterListener<Listeners.OnTick>(OnTick);
        log($"tick-spaced sampling started for {_ticks} ticks");
    }

    private void OnTick()
    {
        if (!_running)
        {
            return;
        }

        for (var i = 0; i < BurstSize; i++)
        {
            var start = Stopwatch.GetTimestamp();
            _noop!.InvokeAsFunction();
            var elapsed = Stopwatch.GetTimestamp() - start;
            (i == 0 ? _dispatch : _dispatchRest).Add(elapsed);
        }

        if (_userIds.Length > 0)
        {
            for (var i = 0; i < BurstSize; i++)
            {
                var id = _userIds[(_remaining + i) % _userIds.Length];
                var start = Stopwatch.GetTimestamp();
                _readHealth!.InvokeAsFunction(id);
                var elapsed = Stopwatch.GetTimestamp() - start;
                (i == 0 ? _read : _readRest).Add(elapsed);
            }
        }

        if (--_remaining > 0)
        {
            return;
        }

        _running = false;
        plugin.RemoveListener<Listeners.OnTick>(OnTick);

        log("");
        log($"--- tick-spaced, bursts of {BurstSize} (first call vs the rest of the same tick) ---");
        log(_dispatch.Report());
        log(_dispatchRest.Report());
        log(_read.Report());
        log(_readRest.Report());
        log("=== step 1 complete ===");
    }
}
