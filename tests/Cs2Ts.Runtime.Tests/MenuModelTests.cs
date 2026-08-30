using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// The pure half of a menu: paging, the highlight, and the two renderings. No player,
/// no server — the same footing <see cref="CommandNameTests"/> tests a command name on.
/// </summary>
public sealed class MenuModelTests
{
    private static MenuModel Menu(int itemCount, params int[] disabled)
    {
        var set = disabled.ToHashSet();
        var items = Enumerable.Range(0, itemCount)
            .Select(i => new MenuEntry($"item {i}", set.Contains(i)))
            .ToArray();

        return new MenuModel("Title", items);
    }

    [Fact]
    public void AMenuNeedsAtLeastOneItem()
    {
        Assert.Throws<ArgumentException>(() => new MenuModel("Title", []));
    }

    [Fact]
    public void OnePageWhenItFits()
    {
        var menu = Menu(5);

        Assert.Equal(1, menu.PageCount);
        Assert.False(menu.HasNext);
        Assert.False(menu.HasPrev);
        Assert.Equal(5, menu.PageItems.Count);
    }

    [Fact]
    public void SevenToAPageThenAnother()
    {
        var menu = Menu(9);

        Assert.Equal(2, menu.PageCount);
        Assert.Equal(7, menu.PageItems.Count);
        Assert.True(menu.HasNext);
        Assert.False(menu.HasPrev);

        Assert.True(menu.NextPage());
        Assert.Equal(1, menu.Page);
        Assert.Equal(2, menu.PageItems.Count);
        Assert.False(menu.HasNext);
        Assert.True(menu.HasPrev);

        Assert.False(menu.NextPage());
        Assert.True(menu.PrevPage());
        Assert.Equal(0, menu.Page);
        Assert.False(menu.PrevPage());
    }

    [Fact]
    public void SelectOnPageIsOneBasedAndPageRelative()
    {
        var menu = Menu(9);

        Assert.Equal(0, menu.SelectOnPage(1));
        Assert.Equal(6, menu.SelectOnPage(7));

        // Past the page's items, and past the digit range.
        Assert.Equal(-1, menu.SelectOnPage(8));
        Assert.Equal(-1, menu.SelectOnPage(0));

        menu.NextPage();
        Assert.Equal(7, menu.SelectOnPage(1));
        Assert.Equal(8, menu.SelectOnPage(2));
        Assert.Equal(-1, menu.SelectOnPage(3));
    }

    [Fact]
    public void ADisabledLineCannotBePickedByNumber()
    {
        var menu = Menu(5, 2);

        Assert.Equal(1, menu.SelectOnPage(2));
        Assert.Equal(-1, menu.SelectOnPage(3));
        Assert.Equal(3, menu.SelectOnPage(4));
    }

    [Fact]
    public void TheCursorStartsOnTheFirstEnabledLine()
    {
        Assert.Equal(0, Menu(5).Cursor);
        Assert.Equal(2, Menu(5, 0, 1).Cursor);
    }

    [Fact]
    public void TheCursorMovesPastDisabledLinesAndStopsAtTheEnds()
    {
        var menu = Menu(5, 2, 3);

        Assert.Equal(0, menu.Cursor);
        Assert.True(menu.CursorDown());
        Assert.Equal(1, menu.Cursor);

        // Skips 2 and 3.
        Assert.True(menu.CursorDown());
        Assert.Equal(4, menu.Cursor);

        // Already at the bottom.
        Assert.False(menu.CursorDown());
        Assert.Equal(4, menu.Cursor);

        Assert.True(menu.CursorUp());
        Assert.Equal(1, menu.Cursor);
        Assert.True(menu.CursorUp());
        Assert.Equal(0, menu.Cursor);
        Assert.False(menu.CursorUp());
    }

    [Fact]
    public void MovingTheCursorPastAPageBoundaryTurnsThePage()
    {
        var menu = Menu(10);

        for (var i = 0; i < 6; i++)
        {
            menu.CursorDown();
        }

        Assert.Equal(6, menu.Cursor);
        Assert.Equal(0, menu.Page);

        Assert.True(menu.CursorDown());
        Assert.Equal(7, menu.Cursor);
        Assert.Equal(1, menu.Page);

        Assert.True(menu.CursorUp());
        Assert.Equal(6, menu.Cursor);
        Assert.Equal(0, menu.Page);
    }

    [Fact]
    public void SelectAtCursorIsMinusOneOnADisabledLine()
    {
        // Every line is disabled, so the cursor has nowhere enabled to sit.
        var menu = Menu(3, 0, 1, 2);
        Assert.Equal(-1, menu.SelectAtCursor());

        var ok = Menu(3);
        Assert.Equal(0, ok.SelectAtCursor());
        ok.CursorDown();
        Assert.Equal(1, ok.SelectAtCursor());
    }

    [Fact]
    public void TheChatRenderingNumbersThePageAndAddsTheKeysThatApply()
    {
        var menu = Menu(9);

        Assert.Equal(
            ["Title", "1. item 0", "2. item 1", "3. item 2", "4. item 3", "5. item 4", "6. item 5", "7. item 6", "8. Next", "0. Exit"],
            menu.RenderChatLines());

        menu.NextPage();
        Assert.Equal(
            ["Title", "1. item 7", "2. item 8", "9. Back", "0. Exit"],
            menu.RenderChatLines());
    }

    [Fact]
    public void TheChatRenderingOfAOnePageMenuHasNeitherNextNorBack()
    {
        Assert.Equal(
            ["Title", "1. item 0", "2. item 1", "0. Exit"],
            Menu(2).RenderChatLines());
    }

    [Fact]
    public void TheCentreRenderingMarksTheHighlightAndPagesWhenThereIsMoreThanOne()
    {
        var menu = Menu(9);
        var html = menu.RenderCenterHtml();

        Assert.Contains("<font color='#ffffff'>Title</font>", html);
        Assert.Contains("&#9656; item 0", html);          // the cursor line
        Assert.Contains("<font color='#aaaaaa'>item 1</font>", html);
        Assert.Contains("(1/2)", html);
        Assert.Contains("W/S move", html);

        menu.CursorDown();
        Assert.Contains("&#9656; item 1", menu.RenderCenterHtml());
        Assert.DoesNotContain("&#9656; item 0", menu.RenderCenterHtml());
    }

    [Fact]
    public void ADisabledLineIsDrawnGreyAndNeverAsTheCursor()
    {
        var menu = Menu(3, 1);
        var html = menu.RenderCenterHtml();

        Assert.Contains("<font color='#666666'>item 1</font>", html);
        Assert.DoesNotContain("&#9656; item 1", html);
    }

    [Fact]
    public void TurningToAPageOfOnlyDisabledLinesLandsOnItsFirstLine()
    {
        // Page two is items 7 and 8, both disabled.
        var menu = Menu(9, 7, 8);

        Assert.True(menu.NextPage());
        Assert.Equal(7, menu.Cursor);
        Assert.Equal(-1, menu.SelectAtCursor());
    }
}
