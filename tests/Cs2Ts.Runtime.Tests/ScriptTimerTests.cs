using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// A host whose clock the test moves by hand.
///
/// Timers are the one part of the runtime whose behaviour is defined in terms of time
/// passing, and a test that waited for real seconds would be slow, flaky, and unable to
/// say anything about a two second hitch. The clock is a seam for exactly this.
/// </summary>
public sealed class TimerHostFixture : IDisposable
{
    public TimerHostFixture()
    {
        Host = new ScriptHost(
            Errors.Add,
            new ScriptHostOptions(Budget: TimeSpan.FromSeconds(2), Clock: () => Now));

        Host.Configure = (_, engine) => engine.AddHostObject("sink", Sink);
    }

    public ScriptHost Host { get; }

    public List<ScriptError> Errors { get; } = [];

    public Sink Sink { get; } = new();

    /// <summary>Seconds. Only the test moves it.</summary>
    public double Now { get; set; }

    public void Dispose() => Host.Dispose();
}

[CollectionDefinition(Name)]
public sealed class TimerHostCollection : ICollectionFixture<TimerHostFixture>
{
    public const string Name = "timer-host";
}

[Collection(TimerHostCollection.Name)]
public sealed class ScriptTimerTests(TimerHostFixture fixture) : IDisposable
{
    private ScriptHost Host => fixture.Host;

    private List<ScriptError> Errors => fixture.Errors;

    private List<int> Recorded => fixture.Sink.Values;

    public void Dispose()
    {
        foreach (var name in Host.Loaded)
        {
            Host.Unload(name);
        }

        fixture.Now = 0;
        Errors.Clear();
        Recorded.Clear();
    }

    private PluginLoadResult Load(string name, string typeScript) =>
        Host.Load(name, $"{name}.ts", typeScript);

    /// <summary>Moves the clock and runs the tick, the way the game loop would.</summary>
    private int Advance(double seconds)
    {
        fixture.Now += seconds;
        return Host.AdvanceTimers();
    }

    [Fact]
    public void ATimeoutFiresOnceAfterItsDelay()
    {
        Assert.True(Load("once", """
            setTimeout((): void => sink.record(1), 500);
            """).Succeeded);

        Assert.Equal(0, Advance(0.4));
        Assert.Empty(Recorded);

        Assert.Equal(1, Advance(0.2));
        Assert.Equal([1], Recorded);

        // Still once, an hour later.
        Advance(3600);
        Assert.Equal([1], Recorded);
        Assert.Equal(0, Host.Timers.Count);
    }

    /// <summary>
    /// A zero delay means the next tick, not this one. Running it immediately would let a
    /// script that reschedules itself with zero hold the tick for as long as it liked,
    /// which is a hang wearing the clothes of a timer.
    /// </summary>
    [Fact]
    public void AZeroDelayWaitsForTheNextTick()
    {
        Assert.True(Load("soon", """
            setTimeout((): void => sink.record(1), 0);
            """).Succeeded);

        Assert.Empty(Recorded);
        Assert.Equal(1, Advance(0));
        Assert.Equal([1], Recorded);
    }

    /// <summary>
    /// The same rule from the other side: a callback that sets a zero-delay timer does
    /// not get to run it before the tick it was called in has finished.
    /// </summary>
    [Fact]
    public void ATimerSetFromInsideACallbackWaitsForTheNextTick()
    {
        Assert.True(Load("chain", """
            setTimeout((): void => {
                sink.record(1);
                setTimeout((): void => sink.record(2), 0);
            }, 0);
            """).Succeeded);

        Assert.Equal(1, Advance(0));
        Assert.Equal([1], Recorded);

        Assert.Equal(1, Advance(0));
        Assert.Equal([1, 2], Recorded);
    }

    [Fact]
    public void AnIntervalRepeatsUntilItIsCleared()
    {
        Assert.True(Load("beat", """
            let n = 0;
            const id = setInterval((): void => {
                n += 1;
                sink.record(n);
                if (n === 3) {
                    clearInterval(id);
                }
            }, 100);
            """).Succeeded);

        for (var i = 0; i < 5; i++)
        {
            Advance(0.1);
        }

        Assert.Equal([1, 2, 3], Recorded);
        Assert.Equal(0, Host.Timers.Count);
    }

    /// <summary>
    /// A hitch must not turn into a burst.
    ///
    /// If a 100ms interval caught up after a two second stall it would fire twenty times
    /// back to back, on the tick where the server has just proved it has no time to
    /// spare. It fires once and is scheduled again from now.
    /// </summary>
    [Fact]
    public void AnIntervalDoesNotCatchUpAfterAHitch()
    {
        Assert.True(Load("hitch", """
            setInterval((): void => sink.record(1), 100);
            """).Succeeded);

        Assert.Equal(1, Advance(2));
        Assert.Single(Recorded);

        Assert.Equal(1, Advance(0.1));
        Assert.Equal(2, Recorded.Count);
    }

    [Fact]
    public void ClearingATimeoutStopsIt()
    {
        Assert.True(Load("cancel", """
            const id = setTimeout((): void => sink.record(1), 100);
            sink.record(clearTimeout(id) ? 10 : 20);
            """).Succeeded);

        Advance(1);
        Assert.Equal([10], Recorded);
        Assert.Equal(0, Host.Timers.Count);
    }

    /// <summary>Cancelling something that never existed is not an error in JavaScript.</summary>
    [Fact]
    public void ClearingAnUnknownTimerIsHarmless()
    {
        Assert.True(Load("unknown", """
            sink.record(clearTimeout(9999) ? 1 : 0);
            sink.record(clearTimeout(-1) ? 1 : 0);
            """).Succeeded);

        Assert.Equal([0, 0], Recorded);
        Assert.Empty(Errors);
    }

    /// <summary>
    /// One callback cancelling another that is due in the same tick must actually stop
    /// it. Both were collected into the same batch before either ran, so the batch has to
    /// be re-checked rather than trusted.
    /// </summary>
    [Fact]
    public void ATimerCancelledByAnEarlierCallbackInTheSameTickDoesNotRun()
    {
        Assert.True(Load("racing", """
            let second = 0;
            setTimeout((): void => {
                sink.record(1);
                clearTimeout(second);
            }, 100);
            second = setTimeout((): void => sink.record(2), 100);
            """).Succeeded);

        Advance(0.1);
        Assert.Equal([1], Recorded);
    }

    /// <summary>
    /// Ids come off one counter shared by every plugin, so a script must not be able to
    /// cancel another script's timer by guessing a number. That would be a way out of its
    /// own sandbox, which is the one thing the boundary is for.
    /// </summary>
    [Fact]
    public void AScriptCannotClearAnotherScriptsTimer()
    {
        Assert.True(Load("owner", """
            const id = setTimeout((): void => sink.record(1), 100);
            sink.record(id);
            """).Succeeded);

        var victim = Recorded.Single();
        Recorded.Clear();

        Assert.True(Load("thief", $$"""
            sink.record(clearTimeout({{victim}}) ? 1 : 0);
            """).Succeeded);

        Assert.Equal([0], Recorded);

        Advance(0.1);
        Assert.Equal([0, 1], Recorded);
    }

    /// <summary>
    /// Unloading takes the plugin's timers with it. A callback firing into a context that
    /// has been destroyed is the failure reloading exists to prevent, not to cause.
    /// </summary>
    [Fact]
    public void UnloadingCancelsThePluginsTimers()
    {
        Assert.True(Load("leaving", """
            setTimeout((): void => sink.record(1), 100);
            setInterval((): void => sink.record(2), 100);
            """).Succeeded);

        Assert.Equal(2, Host.Timers.Count);

        Assert.True(Host.Unload("leaving"));
        Assert.Equal(0, Host.Timers.Count);

        Advance(10);
        Assert.Empty(Recorded);
    }

    /// <summary>
    /// The same thing a reload has to do, stated separately because it is the case an
    /// author meets: the old version's interval must not keep running underneath the new
    /// one, doubling up every time the file is saved.
    /// </summary>
    [Fact]
    public void ReloadingDoesNotLeaveTheOldVersionsIntervalRunning()
    {
        const string Source =
            """
            setInterval((): void => sink.record(1), 100);
            """;

        for (var load = 0; load < 3; load++)
        {
            Assert.True(Load("reloaded", Source).Succeeded);
            Assert.Equal(1, Host.Timers.Count);
        }

        Recorded.Clear();
        Advance(0.1);

        // One interval, not three.
        Assert.Equal([1], Recorded);
    }

    /// <summary>
    /// A timer that throws is reported against the author's own file and line, like any
    /// other handler, and does not reach the caller — which here is the game's tick.
    /// </summary>
    [Fact]
    public void AFailingTimerIsReportedWithItsFileAndLine()
    {
        Assert.True(Load("boom", """
            setTimeout((): void => {
                throw new Error("from the timer");
            }, 100);
            """).Succeeded);

        Advance(0.1);

        var error = Assert.Single(Errors);
        Assert.Equal("boom.ts", error.FileName);
        Assert.Equal(2, error.Line);
    }

    /// <summary>
    /// An interval whose handler always throws is taken out of service by the boundary,
    /// and then the timer stops too. Leaving it scheduled would mean calling something
    /// forever that the boundary has already decided never to call.
    /// </summary>
    [Fact]
    public void AnIntervalThatKeepsThrowingIsEventuallyCancelled()
    {
        Assert.True(Load("always", """
            setInterval((): void => {
                throw new Error("every time");
            }, 100);
            """).Succeeded);

        for (var i = 0; i < 20 && Host.Timers.Count > 0; i++)
        {
            Advance(0.1);
        }

        Assert.Equal(0, Host.Timers.Count);

        // Five failures, then the line saying it has been disabled.
        Assert.Contains(Errors, e => e.Message.Contains("has been disabled"));
    }

    /// <summary>
    /// A handler that sets a timer and never clears one is the shape timer accumulation
    /// actually takes. Refusing the excess makes it an error at the line that caused it;
    /// without a cap it is a leak whose only symptom is memory.
    /// </summary>
    [Fact]
    public void APluginCannotExceedTheTimerCap()
    {
        var result = Load("greedy", $$"""
            for (let i = 0; i < {{TimerTable.MaxPerPlugin + 1}}; i++) {
                setTimeout((): void => {}, 10_000);
            }
            """);

        Assert.False(result.Succeeded);
        Assert.Contains("timers pending", result.Error!.Message);

        // The line that called setTimeout, not the prelude that defines it. Asserting
        // only the message is what let this ship wrong: a server reported
        // "cs2ts:prelude.js(35,12)" while this test was green.
        Assert.Equal("greedy.ts", result.Error.FileName);
        Assert.Equal(2, result.Error.Line);
    }

    /// <summary>
    /// The same rule for the argument checks the prelude makes itself. Every global a
    /// script calls is a prelude function, so without skipping those frames every one of
    /// these refusals points at a file the author has never seen.
    /// </summary>
    [Theory]
    [InlineData("(setTimeout as unknown as (h?: unknown) => number)(undefined);")]
    [InlineData("(setInterval as unknown as (h?: unknown) => number)(undefined);")]
    [InlineData("setTimeout((): void => {}, NaN as number);")]
    public void APreludeRefusalPointsAtTheAuthorsLine(string call)
    {
        var result = Load("refused", $"""
            const marker = 1;
            {call}
            """);

        Assert.False(result.Succeeded);
        Assert.Equal("refused.ts", result.Error!.FileName);
        Assert.Equal(2, result.Error.Line);
    }

    /// <summary>The cap is per plugin, not shared: one greedy script must not starve another.</summary>
    [Fact]
    public void TheCapIsCountedPerPlugin()
    {
        const string Source =
            """
            for (let i = 0; i < 200; i++) {
                setTimeout((): void => {}, 10_000);
            }
            """;

        Assert.True(Load("first", Source).Succeeded);
        Assert.True(Load("second", Source).Succeeded);
        Assert.Equal(400, Host.Timers.Count);
    }

    /// <summary>
    /// A delay that is not a finite number is a bug in the script, and the value it would
    /// otherwise become — NaN compares false against everything, so the timer simply
    /// never fires — is the silent kind this project spends its effort avoiding.
    /// </summary>
    [Theory]
    [InlineData("NaN")]
    [InlineData("Infinity")]
    [InlineData("\"soon\"")]
    public void ANonFiniteDelayIsRefused(string delay)
    {
        var result = Load("bad-delay", $$"""
            setTimeout((): void => {}, {{delay}} as number);
            """);

        Assert.False(result.Succeeded);
        Assert.Contains("finite number", result.Error!.Message);
    }

    [Fact]
    public void AMissingHandlerIsRefused()
    {
        var result = Load("no-handler", """
            (setTimeout as unknown as (h?: unknown) => number)(undefined);
            """);

        Assert.False(result.Succeeded);
        Assert.Contains("must be a function", result.Error!.Message);
    }

    /// <summary>
    /// Omitting the delay means zero, as it does everywhere else in JavaScript.
    /// </summary>
    [Fact]
    public void TheDelayMayBeOmitted()
    {
        Assert.True(Load("bare", """
            (setTimeout as (h: () => void, d?: number) => number)((): void => sink.record(1));
            """).Succeeded);

        Assert.Equal(1, Advance(0));
        Assert.Equal([1], Recorded);
    }

    /// <summary>
    /// A negative delay means "as soon as possible", which is the next tick. It must not
    /// mean "already overdue" in a way that fires inside the tick that set it.
    /// </summary>
    [Fact]
    public void ANegativeDelayIsTreatedAsZero()
    {
        Assert.True(Load("past", """
            setTimeout((): void => sink.record(1), -5000);
            """).Succeeded);

        Assert.Empty(Recorded);
        Assert.Equal(1, Advance(0));
        Assert.Equal([1], Recorded);
    }

    /// <summary>Timers fire in the order they are due, not the order they were set.</summary>
    [Fact]
    public void TimersFireInDueOrder()
    {
        Assert.True(Load("ordered", """
            setTimeout((): void => sink.record(3), 300);
            setTimeout((): void => sink.record(1), 100);
            setTimeout((): void => sink.record(2), 200);
            """).Succeeded);

        Advance(1);
        Assert.Equal([1, 2, 3], Recorded);
    }
}
