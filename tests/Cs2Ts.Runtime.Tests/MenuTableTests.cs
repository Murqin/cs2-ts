using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// The per-player open menu: ownership, input routing, and the centre re-send.
///
/// Handlers are left null here — this is about which line a press resolves to and what
/// becomes of the menu. That a chosen handler actually runs, inside its plugin's
/// boundary, is <see cref="SampleScriptTests"/>'s job, where a real script is loaded.
/// </summary>
public sealed class MenuTableTests : IDisposable
{
    private const long Player = 7;

    private readonly List<ScriptError> _errors = [];
    private readonly ScriptHost _host;
    private readonly ScriptPlugin _a;
    private readonly ScriptPlugin _b;

    private readonly List<(long Id, string Html)> _rendered = [];
    private readonly HashSet<long> _left = [];
    private double _now;

    public MenuTableTests()
    {
        _host = new ScriptHost(_errors.Add, new ScriptHostOptions(Clock: () => _now));
        Assert.True(_host.Load("a", "a.ts", "const x = 1;").Succeeded);
        Assert.True(_host.Load("b", "b.ts", "const x = 1;").Succeeded);
        _a = _host.Find("a")!;
        _b = _host.Find("b")!;
    }

    public void Dispose() => _host.Dispose();

    private MenuTable Table => _host.Menus;

    private static MenuModel Model(int items, string title = "Title") =>
        new(title, Enumerable.Range(0, items).Select(i => new MenuEntry($"item {i}", Disabled: false)).ToArray());

    private static ScriptObject?[] NoHandlers(int items) => new ScriptObject?[items];

    private long OpenChat(ScriptPlugin owner, int items = 3, bool closeOnSelect = true) =>
        Table.Open(owner, Player, Model(items), MenuStyle.Chat, closeOnSelect, NoHandlers(items));

    private long OpenCenter(ScriptPlugin owner, int items = 3, bool closeOnSelect = true) =>
        Table.Open(owner, Player, Model(items), MenuStyle.Center, closeOnSelect, NoHandlers(items));

    private bool Render(long id, string html)
    {
        if (_left.Contains(id))
        {
            return false;
        }

        _rendered.Add((id, html));
        return true;
    }

    private int Tick(double seconds)
    {
        _now += seconds;
        return _host.RefreshMenus(Render);
    }

    [Fact]
    public void OpeningASecondMenuReplacesTheFirst()
    {
        var first = OpenChat(_a);
        var second = OpenChat(_a);

        Assert.Equal(1, Table.Count);
        Assert.False(Table.IsOpen(Player, first));
        Assert.True(Table.IsOpen(Player, second));
    }

    [Fact]
    public void CloseIsOwnerChecked()
    {
        OpenChat(_a);

        Assert.False(Table.Close(_b, Player));
        Assert.Equal(1, Table.Count);

        Assert.True(Table.Close(_a, Player));
        Assert.Equal(0, Table.Count);
    }

    [Fact]
    public void CloseByIdOnlyClosesWhileItIsStillTheOpenOne()
    {
        var first = OpenChat(_a);
        OpenChat(_a);   // replaces first

        Assert.False(Table.CloseById(_a, first));
        Assert.Equal(1, Table.Count);
    }

    [Fact]
    public void DiscardForgetsOnlyThatPluginsMenu()
    {
        OpenChat(_a);
        Assert.Equal(0, Table.Discard(_b));
        Assert.Equal(1, Table.Count);

        Assert.Equal(1, Table.Discard(_a));
        Assert.Equal(0, Table.Count);
        Assert.Equal(1, Table.Dropped);
    }

    [Fact]
    public void UnloadingThePluginClosesItsMenu()
    {
        OpenCenter(_a);
        Assert.Equal(1, Table.Count);

        Assert.True(_host.Unload("a"));
        Assert.Equal(0, Table.Count);
    }

    [Fact]
    public void ADigitPicksTheLineAndClosesWhenCloseOnSelect()
    {
        OpenChat(_a, items: 3);

        var feed = Table.FeedDigit(Player, 2);

        Assert.True(feed.Handled);
        Assert.True(feed.Closed);
        Assert.Equal(_a, feed.Selection!.Value.Owner);
        Assert.Equal(1, feed.Selection.Value.Index);
        Assert.Equal(0, Table.Count);
    }

    [Fact]
    public void WithoutCloseOnSelectTheMenuStaysOpenAfterAPick()
    {
        OpenChat(_a, items: 3, closeOnSelect: false);

        var feed = Table.FeedDigit(Player, 1);

        Assert.Equal(0, feed.Selection!.Value.Index);
        Assert.False(feed.Closed);
        Assert.Equal(1, Table.Count);
    }

    [Fact]
    public void ZeroClosesTheMenuAndPicksNothing()
    {
        OpenChat(_a);

        var feed = Table.FeedDigit(Player, 0);

        Assert.True(feed.Handled);
        Assert.True(feed.Closed);
        Assert.Null(feed.Selection);
        Assert.Equal(0, Table.Count);
    }

    [Fact]
    public void EightAndNineTurnThePages()
    {
        OpenChat(_a, items: 9);

        var next = Table.FeedDigit(Player, 8);
        Assert.True(next is { Handled: true, Redraw: true });

        // Second page has items 7 and 8; picking position 2 there is flat index 8.
        var pick = Table.FeedDigit(Player, 2);
        Assert.Equal(8, pick.Selection!.Value.Index);
    }

    [Fact]
    public void ADigitWithNoLineIsSwallowedButPicksNothing()
    {
        OpenChat(_a, items: 3);

        var feed = Table.FeedDigit(Player, 6);

        Assert.True(feed.Handled);
        Assert.Null(feed.Selection);
        Assert.Equal(1, Table.Count);
    }

    [Fact]
    public void FeedDigitIgnoresACentreMenu()
    {
        OpenCenter(_a);
        Assert.Equal(default, Table.FeedDigit(Player, 1));
    }

    [Fact]
    public void FeedNavIgnoresAChatMenu()
    {
        OpenChat(_a);
        Assert.Equal(default, Table.FeedNav(Player, MenuNav.Select));
    }

    [Fact]
    public void NavMovesTheHighlightAndSelectPicksIt()
    {
        OpenCenter(_a, items: 3);

        Assert.True(Table.FeedNav(Player, MenuNav.Down).Handled);
        var feed = Table.FeedNav(Player, MenuNav.Select);

        Assert.Equal(1, feed.Selection!.Value.Index);
        Assert.True(feed.Closed);
    }

    [Fact]
    public void ACentreMenuIsReDrawnOnTheTickAndAgainAfterItMoves()
    {
        OpenCenter(_a, items: 3);

        Assert.Equal(1, Tick(0));
        Assert.Single(_rendered);
        Assert.Contains("&#9656; item 0", _rendered[^1].Html);

        // Nothing again until the refresh interval passes.
        Assert.Equal(0, Tick(0.5));

        // A move forces an immediate redraw on the next tick.
        Table.FeedNav(Player, MenuNav.Down);
        Assert.Equal(1, Tick(0.1));
        Assert.Contains("&#9656; item 1", _rendered[^1].Html);
    }

    [Fact]
    public void AChatMenuIsNotDrawnByTheTick()
    {
        OpenChat(_a);
        Assert.Equal(0, Tick(0));
        Assert.Empty(_rendered);
    }

    [Fact]
    public void ACentreMenuForAPlayerWhoHasLeftIsDropped()
    {
        OpenCenter(_a);
        Assert.Equal(1, Tick(0));

        _left.Add(Player);
        Assert.Equal(0, Tick(1));
        Assert.Equal(0, Table.Count);
        Assert.Equal(1, Table.Dropped);
    }

    [Fact]
    public void ChatLinesForReturnsTheCurrentPageAndNullForACentreMenu()
    {
        OpenChat(_a, items: 9);
        var lines = Table.ChatLinesFor(Player);
        Assert.NotNull(lines);
        Assert.Equal("Title", lines![0]);
        Assert.Contains("8. Next", lines);

        Table.Close(_a, Player);
        OpenCenter(_a);
        Assert.Null(Table.ChatLinesFor(Player));
    }

    [Fact]
    public void FeedOnAPlayerWithNoMenuDoesNothing()
    {
        Assert.Equal(default, Table.FeedDigit(Player, 1));
        Assert.Equal(default, Table.FeedNav(Player, MenuNav.Select));
    }
}
