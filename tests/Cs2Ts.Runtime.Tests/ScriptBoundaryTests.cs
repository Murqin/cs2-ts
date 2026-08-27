using Cs2Ts.Runtime;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;
using Microsoft.Extensions.Time.Testing;

namespace Cs2Ts.Runtime.Tests;

public sealed class ScriptBoundaryTests : IDisposable
{
    private readonly V8Runtime _runtime = new("boundary-tests");
    private readonly V8ScriptEngine _engine;
    private readonly List<ScriptError> _reported = [];

    public ScriptBoundaryTests()
    {
        _engine = _runtime.CreateScriptEngine("boundary-tests");
    }

    public void Dispose()
    {
        _engine.Dispose();
        _runtime.Dispose();
    }

    private ScriptBoundary Boundary(BoundaryPolicy? policy = null, TimeProvider? time = null) =>
        new("warmup", _reported.Add, policy ?? BoundaryPolicy.Forgiving, time);

    /// <summary>Compiles under the given name so stack frames carry it.</summary>
    private ScriptObject Define(string fileName, string source, string exportedName)
    {
        _engine.Execute(new DocumentInfo(fileName), source);
        return (ScriptObject)_engine.Script[exportedName];
    }

    [Fact]
    public void PassesThroughAResultWhenNothingGoesWrong()
    {
        var handler = Define("warmup.ts", "function add(a, b) { return a + b; }", "add");

        var outcome = Boundary().Invoke("add", () => handler.InvokeAsFunction(2, 3), out var result);

        Assert.Equal(BoundaryOutcome.Completed, outcome);
        Assert.Equal(5, result);
        Assert.Empty(_reported);
    }

    /// <summary>
    /// The whole point: the caller is a CounterStrikeSharp event handler running under
    /// native code, so a throw that escapes takes the server with it.
    /// </summary>
    [Fact]
    public void ContainsAThrowAndAttributesItToThePluginFileAndLine()
    {
        var handler = Define(
            "warmup.ts",
            """
            function inner(player) {
                throw new Error("player " + player + " has no pawn");
            }

            function onSpawn(player) {
                inner(player);
            }
            """,
            "onSpawn");

        var outcome = Boundary().Invoke("player_spawn", () => handler.InvokeAsFunction(7));

        Assert.Equal(BoundaryOutcome.Failed, outcome);
        var error = Assert.Single(_reported);
        Assert.Equal(ScriptErrorSource.Script, error.Source);
        Assert.Equal("warmup", error.PluginName);
        Assert.Equal("Error: player 7 has no pawn", error.Message);
        Assert.Equal("warmup.ts", error.FileName);
        Assert.Equal(2, error.Line);
        Assert.Equal(11, error.Column);
        Assert.Contains("at onSpawn", error.StackTrace);
        Assert.Equal("warmup.ts(2,11): error in plugin 'warmup': Error: player 7 has no pawn", error.ToString());
    }

    /// <summary>
    /// Authors do write `throw "nope"`. V8 reports the message as "[object Object]" for
    /// a thrown object, which is unhelpful but must not stop the frames being read.
    /// </summary>
    [Fact]
    public void ContainsAThrowOfSomethingThatIsNotAnError()
    {
        var handler = Define("warmup.ts", "function bad() { throw { code: 42 }; }", "bad");

        Assert.Equal(BoundaryOutcome.Failed, Boundary().Invoke("bad", () => handler.InvokeAsFunction()));

        var error = Assert.Single(_reported);
        Assert.Equal("warmup.ts", error.FileName);
        Assert.Equal(1, error.Line);
    }

    /// <summary>
    /// An async handler returns a pending promise, so the throw inside it happens after
    /// the call is over. Without the boundary watching the promise, V8 files the
    /// rejection somewhere nothing in this process ever reads.
    /// </summary>
    [Fact]
    public void ReportsAnAsyncHandlerThatRejects()
    {
        var handler = Define(
            "warmup.ts",
            """
            async function onConnect(player) {
                throw new Error("no database connection");
            }
            """,
            "onConnect");

        var outcome = Boundary().Invoke("player_connect", () => handler.InvokeAsFunction(1));

        // The call itself completed: the failure had not happened yet.
        Assert.Equal(BoundaryOutcome.Completed, outcome);

        // Draining the microtask queue is what delivers the rejection.
        _engine.Execute("void 0;");

        var error = Assert.Single(_reported);
        Assert.True(error.IsAsync);
        Assert.Equal("Error: no database connection", error.Message);
        Assert.Equal("warmup", error.PluginName);
        Assert.Contains("unhandled rejection", error.ToString());
    }

    [Fact]
    public void DoesNotReportAnAsyncHandlerThatSucceeds()
    {
        var handler = Define("warmup.ts", "async function ok() { return 1; }", "ok");

        Assert.Equal(BoundaryOutcome.Completed, Boundary().Invoke("ok", () => handler.InvokeAsFunction()));
        _engine.Execute("void 0;");

        Assert.Empty(_reported);
    }

    [Fact]
    public void ReportsARejectionThatIsNotAnError()
    {
        var handler = Define("warmup.ts", "async function odd() { return Promise.reject('plain string'); }", "odd");

        Boundary().Invoke("odd", () => handler.InvokeAsFunction());
        _engine.Execute("void 0;");

        var error = Assert.Single(_reported);
        Assert.Equal("rejected with plain string", error.Message);
    }

    /// <summary>
    /// A host-side failure is contained just as firmly, but is not blamed on the .ts —
    /// otherwise a bug in this layer sends the author hunting through their own code.
    /// </summary>
    [Fact]
    public void ContainsAHostFailureWithoutBlamingThePlugin()
    {
        var outcome = Boundary().Invoke("dispatch", new Func<object?>(() => throw new InvalidOperationException("gamedata missing")));

        Assert.Equal(BoundaryOutcome.Failed, outcome);
        var error = Assert.Single(_reported);
        Assert.Equal(ScriptErrorSource.Host, error.Source);
        Assert.Contains("InvalidOperationException: gamedata missing", error.Message);
        Assert.Contains("host error", error.ToString());
    }

    [Fact]
    public void DisablesAHandlerThatKeepsFailingAndSaysSoOnce()
    {
        var time = new FakeTimeProvider();
        var boundary = Boundary(new BoundaryPolicy(MaxFailures: 3, Window: TimeSpan.FromSeconds(10)), time);
        var handler = Define("warmup.ts", "function onTick() { throw new Error('every tick'); }", "onTick");

        for (var i = 0; i < 3; i++)
        {
            Assert.Equal(BoundaryOutcome.Failed, boundary.Invoke("tick", () => handler.InvokeAsFunction()));
            time.Advance(TimeSpan.FromMilliseconds(16));
        }

        Assert.True(boundary.IsDisabled("tick"));
        Assert.Equal(["tick"], boundary.DisabledHandlers);

        // Three failures, plus one line explaining the handler is now out of service.
        Assert.Equal(4, _reported.Count);
        Assert.Contains("has been disabled", _reported[^1].Message);

        // And it really stops being called.
        Assert.Equal(BoundaryOutcome.Skipped, boundary.Invoke("tick", () => handler.InvokeAsFunction()));
        Assert.Equal(4, _reported.Count);
    }

    /// <summary>
    /// Failures spread over hours are not a flood. Without the sliding window a handler
    /// that fails once a day would eventually be disabled for no good reason.
    /// </summary>
    [Fact]
    public void DoesNotDisableAHandlerWhoseFailuresAreSpreadOut()
    {
        var time = new FakeTimeProvider();
        var boundary = Boundary(new BoundaryPolicy(MaxFailures: 3, Window: TimeSpan.FromSeconds(10)), time);
        var handler = Define("warmup.ts", "function rare() { throw new Error('sometimes'); }", "rare");

        for (var i = 0; i < 10; i++)
        {
            boundary.Invoke("rare", () => handler.InvokeAsFunction());
            time.Advance(TimeSpan.FromSeconds(30));
        }

        Assert.False(boundary.IsDisabled("rare"));
        Assert.Equal(10, _reported.Count);
    }

    [Fact]
    public void FloodProtectionIsPerHandlerNotPerPlugin()
    {
        var time = new FakeTimeProvider();
        var boundary = Boundary(new BoundaryPolicy(MaxFailures: 2, Window: TimeSpan.FromSeconds(10)), time);
        var handler = Define("warmup.ts", "function bad() { throw new Error('x'); }", "bad");

        boundary.Invoke("a", () => handler.InvokeAsFunction());
        boundary.Invoke("a", () => handler.InvokeAsFunction());
        boundary.Invoke("b", () => handler.InvokeAsFunction());

        Assert.True(boundary.IsDisabled("a"));
        Assert.False(boundary.IsDisabled("b"));
    }

    /// <summary>
    /// Reloading is the author saying they fixed it; a reload that inherits the old
    /// verdict looks like the fix did not work.
    /// </summary>
    [Fact]
    public void ResetPutsADisabledHandlerBackInService()
    {
        var time = new FakeTimeProvider();
        var boundary = Boundary(new BoundaryPolicy(MaxFailures: 1, Window: TimeSpan.FromSeconds(10)), time);
        var handler = Define("warmup.ts", "function bad() { throw new Error('x'); }", "bad");

        boundary.Invoke("tick", () => handler.InvokeAsFunction());
        Assert.True(boundary.IsDisabled("tick"));

        boundary.Reset("tick");
        Assert.False(boundary.IsDisabled("tick"));
        Assert.Empty(boundary.DisabledHandlers);
    }

    /// <summary>
    /// The reporter is host code and can have bugs of its own. If a throw from it
    /// escaped, the boundary would cause exactly the crash it exists to prevent.
    /// </summary>
    [Fact]
    public void SurvivesAReporterThatThrows()
    {
        var boundary = new ScriptBoundary("warmup", _ => throw new InvalidOperationException("log is full"));
        var handler = Define("warmup.ts", "function bad() { throw new Error('x'); }", "bad");

        var outcome = boundary.Invoke("tick", () => handler.InvokeAsFunction());

        Assert.Equal(BoundaryOutcome.Failed, outcome);
    }

    [Fact]
    public void ReportsInterruptionSeparatelyFromAThrow()
    {
        var handler = Define("warmup.ts", "function spin() { while (true) {} }", "spin");
        var boundary = Boundary();

        using var timer = new Timer(_ => _engine.Interrupt(), null, TimeSpan.FromMilliseconds(200), Timeout.InfiniteTimeSpan);
        var outcome = boundary.Invoke("tick", () => handler.InvokeAsFunction());

        Assert.Equal(BoundaryOutcome.Failed, outcome);
        var error = Assert.Single(_reported);
        Assert.Equal(ScriptErrorSource.Interrupted, error.Source);
        Assert.Contains("interrupted", error.ToString());
    }

    /// <summary>
    /// The known gap, pinned so it is a decision rather than a surprise. ClearScript
    /// 7.5.1 exposes no equivalent of V8's SetPromiseRejectCallback — there is no flag
    /// and no member for it — so a promise the plugin creates and never returns to the
    /// host rejects into a queue nothing here can read. Promises that cross the
    /// boundary are covered; these are not.
    ///
    /// If a future ClearScript exposes the callback, this test should start failing.
    /// </summary>
    [Fact]
    public void CannotSeeARejectionThatNeverCrossesTheBoundary()
    {
        var handler = Define(
            "warmup.ts",
            """
            async function leaks() { throw new Error("floating"); }
            function onLoad() { leaks(); }
            """,
            "onLoad");

        Assert.Equal(BoundaryOutcome.Completed, Boundary().Invoke("load", () => handler.InvokeAsFunction()));
        _engine.Execute("void 0;");
        _engine.CollectGarbage(true);

        Assert.Empty(_reported);
    }
}
