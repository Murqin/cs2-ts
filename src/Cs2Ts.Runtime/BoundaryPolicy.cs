namespace Cs2Ts.Runtime;

/// <summary>
/// When a misbehaving handler stops being worth calling.
///
/// A handler that throws on every tick costs twice: it floods the log, and it pays the
/// boundary crossing and the exception unwind 64 times a second for nothing. Both are
/// bounded by taking the handler out of service and saying so once.
/// </summary>
/// <param name="MaxFailures">
/// Failures within <paramref name="Window"/> before the handler is disabled. One-off
/// failures are expected — a dead entity, a missing config key — so the default leaves
/// room for them.
/// </param>
/// <param name="Window">How far back failures are counted.</param>
public sealed record BoundaryPolicy(int MaxFailures = 5, TimeSpan Window = default)
{
    /// <summary>Never disables a handler, however often it fails.</summary>
    public static BoundaryPolicy Forgiving { get; } = new(int.MaxValue, TimeSpan.FromSeconds(1));

    /// <summary>Five failures in ten seconds.</summary>
    public static BoundaryPolicy Default { get; } = new();

    /// <summary>
    /// Ten seconds at 64 tick is over six hundred chances to fail, so a handler that
    /// trips this is failing on a large fraction of its calls rather than unluckily.
    /// </summary>
    public TimeSpan Window { get; } = Window == default ? TimeSpan.FromSeconds(10) : Window;
}
