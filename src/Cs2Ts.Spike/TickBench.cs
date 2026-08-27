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
    private readonly Samples _dispatch = new("js callback, per tick", ticks);
    private readonly Samples _read = new("js -> facade -> health, per tick", ticks);
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

        var start = Stopwatch.GetTimestamp();
        _noop!.InvokeAsFunction();
        _dispatch.Add(Stopwatch.GetTimestamp() - start);

        if (_userIds.Length > 0)
        {
            var id = _userIds[_remaining % _userIds.Length];
            start = Stopwatch.GetTimestamp();
            _readHealth!.InvokeAsFunction(id);
            _read.Add(Stopwatch.GetTimestamp() - start);
        }

        if (--_remaining > 0)
        {
            return;
        }

        _running = false;
        plugin.RemoveListener<Listeners.OnTick>(OnTick);

        log("");
        log("--- tick-spaced (one call per tick: closer to how handlers actually fire) ---");
        log(_dispatch.Report());
        log(_read.Report());
        log("=== step 1 complete ===");
    }
}
