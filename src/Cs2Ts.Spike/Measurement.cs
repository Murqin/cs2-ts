using System.Diagnostics;
using System.Globalization;

namespace Cs2Ts.Spike;

/// <summary>
/// One measured population, with every sample kept so the tail can be reported.
/// Averages hide exactly what matters here: a mean well inside budget can still carry
/// a p99 that blows a 15.6 ms tick.
/// </summary>
internal sealed class Samples(string name, int capacity)
{
    private readonly double[] _micros = new double[capacity];
    private int _count;

    public string Name { get; } = name;
    public int Count => _count;

    public void Add(long ticks) => Add(ticks * Measurement.MicrosPerTick);

    public void Add(double micros)
    {
        if (_count < _micros.Length)
        {
            _micros[_count++] = micros;
        }
    }

    public double[] Sorted()
    {
        var sorted = _micros.AsSpan(0, _count).ToArray();
        Array.Sort(sorted);
        return sorted;
    }

    public double Percentile(int percentile)
    {
        if (_count == 0)
        {
            return double.NaN;
        }

        var sorted = Sorted();
        // Nearest-rank. With thousands of samples the gap from an interpolating
        // definition sits far below the noise being measured.
        var rank = (int)Math.Ceiling(percentile / 100.0 * sorted.Length) - 1;
        return sorted[Math.Clamp(rank, 0, sorted.Length - 1)];
    }

    public string Report()
    {
        if (_count == 0)
        {
            return $"{Name,-38} (no samples)";
        }

        var sorted = Sorted();
        return string.Create(
            CultureInfo.InvariantCulture,
            $"{Name,-38} n={_count,-7} mean={sorted.Average(),8:F3} p50={Percentile(50),8:F3} p90={Percentile(90),8:F3} p99={Percentile(99),8:F3} max={sorted[^1],9:F3}");
    }
}

internal static class Measurement
{
    public static readonly double MicrosPerTick = 1_000_000.0 / Stopwatch.Frequency;

    /// <summary>
    /// Cost of the timestamp pair itself, as a median. At the microsecond scale being
    /// measured this is not negligible, and a number reported without it invites
    /// reading noise as signal. The median rather than the mean, because the tail here
    /// is scheduler noise, not the cost of reading the clock.
    /// </summary>
    public static double TimerOverheadMicros(int iterations = 20_000)
    {
        for (var i = 0; i < 1_000; i++)
        {
            _ = Stopwatch.GetTimestamp();
        }

        var samples = new Samples("timer", iterations);
        for (var i = 0; i < iterations; i++)
        {
            var start = Stopwatch.GetTimestamp();
            var end = Stopwatch.GetTimestamp();
            samples.Add(end - start);
        }

        return samples.Percentile(50);
    }

    /// <summary>
    /// Times <paramref name="action"/> once per iteration, recording each call
    /// separately rather than dividing a total. A total only yields a mean, and the
    /// mean is the one statistic that cannot answer the frametime question.
    /// </summary>
    public static Samples TimeEach(string name, int iterations, int warmup, Action action)
    {
        for (var i = 0; i < warmup; i++)
        {
            action();
        }

        var samples = new Samples(name, iterations);
        for (var i = 0; i < iterations; i++)
        {
            var start = Stopwatch.GetTimestamp();
            action();
            samples.Add(Stopwatch.GetTimestamp() - start);
        }

        return samples;
    }
}
