using System.Diagnostics;
using CounterStrikeSharp.API.Core;

namespace Cs2Ts.Spike;

/// <summary>
/// The frametime criterion, measured the way the design document asks for it: not
/// against zero, but against the same server without the scripting layer.
///
/// The interval between consecutive ticks is the thing a player feels. A garbage
/// collection that stalls the game thread shows up here and nowhere else — the boundary
/// benchmarks time their own call and would miss a pause that lands between two of them.
///
/// Run once with CS2TS_NO_V8=1 for the CounterStrikeSharp baseline and once without it
/// for the loaded case; the two distributions are the comparison.
/// </summary>
internal sealed class FrametimeBench(BasePlugin plugin, Action<string> log, int ticks, Action? perTickWork)
{
    private readonly Samples _frametime = new("tick interval (ms)", ticks);
    private readonly int _ticks = ticks;
    private long _previous;
    private int _remaining = ticks;
    private bool _running;

    public void Start()
    {
        _running = true;
        _previous = 0;
        plugin.RegisterListener<Listeners.OnTick>(OnTick);
        log($"frametime sampling started for {_ticks} ticks ({(perTickWork is null ? "idle" : "with per-tick script work")})");
    }

    private void OnTick()
    {
        if (!_running)
        {
            return;
        }

        perTickWork?.Invoke();

        var now = Stopwatch.GetTimestamp();
        if (_previous != 0)
        {
            _frametime.Add((now - _previous) * Measurement.MicrosPerTick / 1000.0);
        }

        _previous = now;

        if (--_remaining > 0)
        {
            return;
        }

        _running = false;
        plugin.RemoveListener<Listeners.OnTick>(OnTick);

        log("");
        log("--- frametime distribution (ms between ticks) ---");
        log(_frametime.Report());

        var sorted = _frametime.Sorted();
        // A 64 tick server owes a frame every 15.625 ms. Counting the overruns says
        // more than a percentile does: one stall in ten thousand ticks is noise, one
        // in fifty is a broken server.
        var over = sorted.Count(ms => ms > 15.625);
        var overBadly = sorted.Count(ms => ms > 20.0);
        log($"ticks over 15.625 ms: {over}/{sorted.Length}   over 20 ms: {overBadly}/{sorted.Length}");
        log("=== frametime complete ===");
    }
}
