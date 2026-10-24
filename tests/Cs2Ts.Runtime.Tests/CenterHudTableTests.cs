using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// The kept-centre-message table, driven by a clock the test moves by hand.
///
/// Like timers, its behaviour is defined in terms of time passing — it re-sends a
/// message on a schedule — so a test that waited for real seconds could say nothing
/// about it. The <see cref="ScriptPlugin"/> owners are real ones, loaded through a
/// throwaway host, because ownership is reference identity and a fake would not be the
/// same object the discard path compares against.
/// </summary>
public sealed class CenterHudTableTests : IDisposable
{
    private readonly List<ScriptError> _errors = [];
    private readonly ScriptHost _host;
    private readonly ScriptPlugin _a;
    private readonly ScriptPlugin _b;

    /// <summary>Every (playerId, text) pair handed to the send callback, in order.</summary>
    private readonly List<(long Id, string Text)> _sent = [];

    /// <summary>Player ids the send callback should report as gone.</summary>
    private readonly HashSet<long> _left = [];

    private double _now;

    public CenterHudTableTests()
    {
        _host = new ScriptHost(_errors.Add, new ScriptHostOptions(Clock: () => _now));
        Assert.True(_host.Load("a", "a.ts", "const x = 1;").Succeeded);
        Assert.True(_host.Load("b", "b.ts", "const x = 1;").Succeeded);
        _a = _host.Find("a")!;
        _b = _host.Find("b")!;
    }

    public void Dispose() => _host.Dispose();

    private CenterHudTable Table => _host.CenterHud;

    private bool Send(long id, string text)
    {
        if (_left.Contains(id))
        {
            return false;
        }

        _sent.Add((id, text));
        return true;
    }

    /// <summary>Moves the clock and runs the re-send, the way the game loop would.</summary>
    private int Tick(double seconds)
    {
        _now += seconds;
        return Table.Tick(_now, Send);
    }

    [Fact]
    public void ShowSendsEveryTickWhileItIsUp()
    {
        Table.Show(_a, 7, "hello");
        Assert.Equal(1, Table.Count);

        // Every tick, not once a period: CS2 replays the centre-HTML fade on each send,
        // so a slower cadence shows as a pulse rather than a steady panel.
        Assert.Equal(1, Tick(0));
        Assert.Equal(1, Tick(0.016));
        Assert.Equal(1, Tick(0.016));
        Assert.Equal([(7L, "hello"), (7L, "hello"), (7L, "hello")], _sent);
    }

    [Fact]
    public void ShowReplacesTheTextAndSendsTheNewOnePromptly()
    {
        Table.Show(_a, 7, "first");
        Tick(0);
        Assert.Equal([(7L, "first")], _sent);

        // A replacement is due immediately, not a refresh interval from now.
        Table.Show(_a, 7, "second");
        Assert.Equal(1, Table.Count);
        Assert.Equal(1, Tick(0.1));
        Assert.Equal([(7L, "first"), (7L, "second")], _sent);
    }

    [Fact]
    public void ClearStopsTheReSend()
    {
        Table.Show(_a, 7, "hello");
        Tick(0);

        Assert.True(Table.Clear(_a, 7));
        Assert.Equal(0, Table.Count);

        _sent.Clear();
        Tick(10);
        Assert.Empty(_sent);
    }

    [Fact]
    public void ClearingWhatIsNotThereIsHarmless()
    {
        Assert.False(Table.Clear(_a, 7));
        Assert.Empty(_errors);
    }

    [Fact]
    public void OnePlayerCannotHaveTwoMessagesAndTheLastWriteWins()
    {
        Table.Show(_a, 7, "from a");
        Table.Show(_b, 7, "from b");

        Assert.Equal(1, Table.Count);
        Tick(0);
        Assert.Equal([(7L, "from b")], _sent);
    }

    /// <summary>
    /// The owner is checked, not assumed: without it one script could wipe another's
    /// message, which is a way to reach outside its own sandbox.
    /// </summary>
    [Fact]
    public void AScriptCannotClearAnotherScriptsMessage()
    {
        Table.Show(_a, 7, "from a");

        Assert.False(Table.Clear(_b, 7));
        Assert.Equal(1, Table.Count);

        Tick(0);
        Assert.Equal([(7L, "from a")], _sent);
    }

    [Fact]
    public void DiscardForgetsOnlyThatPluginsMessages()
    {
        Table.Show(_a, 7, "a-seven");
        Table.Show(_a, 8, "a-eight");
        Table.Show(_b, 9, "b-nine");

        Assert.Equal(2, Table.Discard(_a));
        Assert.Equal(1, Table.Count);
        Assert.Equal(2, Table.Dropped);

        Tick(0);
        Assert.Equal([(9L, "b-nine")], _sent);
    }

    /// <summary>
    /// Unloading a plugin takes its centre messages with it — a reload does not leave
    /// the previous version's text on a screen with nothing left to clear it.
    /// </summary>
    [Fact]
    public void UnloadingThePluginClearsItsMessages()
    {
        Table.Show(_a, 7, "hello");
        Assert.Equal(1, Table.Count);

        Assert.True(_host.Unload("a"));
        Assert.Equal(0, Table.Count);

        Tick(0);
        Assert.Empty(_sent);
    }

    /// <summary>
    /// A player the send callback reports gone has nothing on screen to keep refreshing
    /// and no clear() coming, so the entry drops itself on the next tick.
    /// </summary>
    [Fact]
    public void AMessageForAPlayerWhoHasLeftDropsItself()
    {
        Table.Show(_a, 7, "hello");
        Tick(0);
        Assert.Single(_sent);

        _left.Add(7);
        Assert.Equal(0, Tick(1));
        Assert.Equal(0, Table.Count);
        Assert.Equal(1, Table.Dropped);

        // Even once the player is back, the entry is gone until the script shows it again.
        _left.Remove(7);
        _sent.Clear();
        Tick(1);
        Assert.Empty(_sent);
    }

    [Fact]
    public void RefreshCenterHudOnTheHostDrivesTheTable()
    {
        Table.Show(_a, 7, "hello");

        _now += 0;
        Assert.Equal(1, _host.RefreshCenterHud(Send));
        Assert.Equal([(7L, "hello")], _sent);
    }
}
