using System.Diagnostics;
using System.Globalization;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Spike;

/// <summary>
/// Phase 0, step 1: what does one crossing of the C# / JavaScript boundary cost?
///
/// Every benchmark here is paired with a baseline that does the same work without
/// crossing, because the crossing is the only quantity of interest. A raw "JS callback
/// took N microseconds" number includes the delegate dispatch, the loop, and the clock,
/// and attributing all of it to the boundary overstates it.
/// </summary>
internal static class BoundaryBench
{
    public static void Run(V8ScriptEngine engine, Action<string> log, int iterations, int warmup)
    {
        var timer = Measurement.TimerOverheadMicros();
        log($"timer overhead (median) = {timer.ToString("F3", CultureInfo.InvariantCulture)} us");
        log($"iterations={iterations} warmup={warmup}");
        log("");
        log("--- C# -> JS dispatch (warm loop: a floor, not a ceiling) ---");

        var host = new HostFacade();
        engine.AddHostObject("host", host);
        engine.Execute(
            """
            function noop() {}
            function withInt(n) { return n; }
            function withObject(o) { return o; }
            function callHost(n) { for (let i = 0; i < n; i++) host.Ping(); }
            function emptyLoop(n) { for (let i = 0; i < n; i++) {} }
            """);

        var noop = (ScriptObject)engine.Script.noop;
        var withInt = (ScriptObject)engine.Script.withInt;
        var withObject = (ScriptObject)engine.Script.withObject;

        // The baseline: a C# delegate call that does nothing. Whatever this costs is
        // dispatch and measurement, not boundary, and it is what gets subtracted below.
        Action csharpNoop = static () => { };

        var baseline = Measurement.TimeEach("csharp delegate (baseline)", iterations, warmup, csharpNoop);
        var js0 = Measurement.TimeEach("js callback, 0 args", iterations, warmup, () => noop.InvokeAsFunction());
        var js1 = Measurement.TimeEach("js callback, 1 int", iterations, warmup, () => withInt.InvokeAsFunction(42));
        var jsObj = Measurement.TimeEach("js callback, 1 host object", iterations, warmup, () => withObject.InvokeAsFunction(host));

        foreach (var samples in new[] { baseline, js0, js1, jsObj })
        {
            log(samples.Report());
        }

        log("");
        log(string.Create(
            CultureInfo.InvariantCulture,
            $"boundary cost (p50) = {js0.Percentile(50) - baseline.Percentile(50):F3} us    " +
            $"(p99) = {js0.Percentile(99) - baseline.Percentile(99):F3} us"));

        log("");
        log("--- JS -> C# host call (mean only: cannot be timed from inside JS) ---");

        var callHost = (ScriptObject)engine.Script.callHost;
        var emptyLoop = (ScriptObject)engine.Script.emptyLoop;
        const int InnerCalls = 200_000;

        var loopOnly = TimeOnce(() => emptyLoop.InvokeAsFunction(InnerCalls), warmupRuns: 3);
        var loopWithCalls = TimeOnce(() => callHost.InvokeAsFunction(InnerCalls), warmupRuns: 3);
        var perCall = (loopWithCalls - loopOnly) / InnerCalls;

        log(string.Create(
            CultureInfo.InvariantCulture,
            $"js loop {InnerCalls} iterations: empty={loopOnly * 1000:F1} us, with host calls={loopWithCalls * 1000:F1} us"));
        log(string.Create(CultureInfo.InvariantCulture, $"host call from JS = {perCall * 1000:F4} us/call (mean)"));
        log($"host counter = {host.Counter} (expected {InnerCalls * 4})");
    }

    /// <summary>Milliseconds for a single run, after warming.</summary>
    private static double TimeOnce(Action action, int warmupRuns)
    {
        for (var i = 0; i < warmupRuns; i++)
        {
            action();
        }

        var start = Stopwatch.GetTimestamp();
        action();
        return (Stopwatch.GetTimestamp() - start) * Measurement.MicrosPerTick / 1000.0;
    }
}
