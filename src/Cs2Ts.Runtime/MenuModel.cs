using System.Text;

namespace Cs2Ts.Runtime;

/// <summary>How a menu is drawn, and therefore how it is navigated.</summary>
public enum MenuStyle
{
    /// <summary>Numbered lines in chat; the player picks by typing a digit.</summary>
    Chat,

    /// <summary>An HTML block in the centre of the screen; the player moves a highlight with W/S and picks with E.</summary>
    Center,
}

/// <summary>One line of a menu.</summary>
/// <param name="Text">
/// What the line says. It is passed through untouched — HTML in a centre menu, plain in
/// a chat one — so a menu that might be shown either way should keep its text plain.
/// </param>
/// <param name="Disabled">Shown greyed out and skipped by both the highlight and a digit.</param>
public readonly record struct MenuEntry(string Text, bool Disabled);

/// <summary>
/// A menu's contents and where the cursor is in it, with no idea of who is looking or
/// how the input arrived. The pure half — paging, the highlight, and both renderings —
/// so that all of it can be tested without a player, the way <see cref="CommandName"/>
/// is tested without a server.
///
/// The two styles share this because they are the same menu: one list of lines split
/// into pages. What differs is the input, and that stays in the binding.
/// </summary>
public sealed class MenuModel
{
    /// <summary>Lines per page. Seven leaves 8 and 9 for paging and 0 for closing.</summary>
    public const int PageSize = 7;

    private readonly IReadOnlyList<MenuEntry> _items;

    /// <param name="title">The heading, drawn above the lines.</param>
    /// <param name="items">The lines, at least one. Order is kept.</param>
    /// <exception cref="ArgumentException"><paramref name="items"/> is empty.</exception>
    public MenuModel(string title, IReadOnlyList<MenuEntry> items)
    {
        ArgumentNullException.ThrowIfNull(title);
        ArgumentNullException.ThrowIfNull(items);

        if (items.Count == 0)
        {
            throw new ArgumentException("a menu needs at least one item", nameof(items));
        }

        Title = title;
        _items = items;
        Cursor = FirstEnabledFrom(0, forward: true) ?? 0;
    }

    /// <summary>The heading.</summary>
    public string Title { get; }

    /// <summary>How many lines the menu has in total.</summary>
    public int Count => _items.Count;

    /// <summary>
    /// The highlighted line, as a flat index into the original list. Only meaningful for
    /// a centre menu; a chat menu never moves it.
    /// </summary>
    public int Cursor { get; private set; }

    /// <summary>Which page the cursor is on, counting from zero.</summary>
    public int Page => Cursor / PageSize;

    /// <summary>How many pages the menu has.</summary>
    public int PageCount => (_items.Count + PageSize - 1) / PageSize;

    /// <summary>Whether there is a page after this one.</summary>
    public bool HasNext => Page + 1 < PageCount;

    /// <summary>Whether there is a page before this one.</summary>
    public bool HasPrev => Page > 0;

    /// <summary>The lines on the current page, in order.</summary>
    public IReadOnlyList<MenuEntry> PageItems
    {
        get
        {
            var start = Page * PageSize;
            var end = Math.Min(start + PageSize, _items.Count);
            var slice = new MenuEntry[end - start];
            for (var i = start; i < end; i++)
            {
                slice[i - start] = _items[i];
            }

            return slice;
        }
    }

    /// <summary>
    /// The flat index the <paramref name="oneBasedPosition"/>-th line of the current
    /// page picks, or -1 when that position is empty or its line is disabled.
    /// </summary>
    public int SelectOnPage(int oneBasedPosition)
    {
        if (oneBasedPosition is < 1 or > PageSize)
        {
            return -1;
        }

        var flat = (Page * PageSize) + (oneBasedPosition - 1);
        return flat < _items.Count && !_items[flat].Disabled ? flat : -1;
    }

    /// <summary>The flat index the highlight is on, or -1 when it is on a disabled line.</summary>
    public int SelectAtCursor() => _items[Cursor].Disabled ? -1 : Cursor;

    /// <summary>Moves the highlight up one enabled line, changing page if it has to. Returns whether it moved.</summary>
    public bool CursorUp() => MoveCursor(forward: false);

    /// <summary>Moves the highlight down one enabled line, changing page if it has to. Returns whether it moved.</summary>
    public bool CursorDown() => MoveCursor(forward: true);

    /// <summary>Turns to the next page, putting the highlight on its first enabled line. Returns whether it moved.</summary>
    public bool NextPage() => TurnPage(1);

    /// <summary>Turns to the previous page. Returns whether it moved.</summary>
    public bool PrevPage() => TurnPage(-1);

    /// <summary>
    /// The chat rendering: the title, the page's lines numbered from one, then whichever
    /// of Next, Back and Exit apply.
    /// </summary>
    public IReadOnlyList<string> RenderChatLines()
    {
        var lines = new List<string> { Title };

        var page = PageItems;
        for (var i = 0; i < page.Count; i++)
        {
            lines.Add($"{i + 1}. {page[i].Text}");
        }

        if (HasNext)
        {
            lines.Add("8. Next");
        }

        if (HasPrev)
        {
            lines.Add("9. Back");
        }

        lines.Add("0. Exit");
        return lines;
    }

    /// <summary>
    /// The centre rendering: an HTML block with the highlighted line marked, the page
    /// counter when there is more than one, and a line saying which keys move it.
    /// </summary>
    public string RenderCenterHtml()
    {
        var html = new StringBuilder();
        html.Append($"<font color='#ffffff'>{Title}</font>");

        var start = Page * PageSize;
        var page = PageItems;
        for (var i = 0; i < page.Count; i++)
        {
            var entry = page[i];
            var flat = start + i;
            html.Append("<br>");

            if (entry.Disabled)
            {
                html.Append($"<font color='#666666'>{entry.Text}</font>");
            }
            else if (flat == Cursor)
            {
                html.Append($"<font color='#ffcc00'>&#9656; {entry.Text}</font>");
            }
            else
            {
                html.Append($"<font color='#aaaaaa'>{entry.Text}</font>");
            }
        }

        if (PageCount > 1)
        {
            html.Append($"<br><font color='#888888'>({Page + 1}/{PageCount})</font>");
        }

        html.Append("<br><font color='#888888'>W/S move &#183; E select</font>");
        return html.ToString();
    }

    private bool MoveCursor(bool forward)
    {
        var next = FirstEnabledFrom(forward ? Cursor + 1 : Cursor - 1, forward);
        if (next is not { } target || target == Cursor)
        {
            return false;
        }

        Cursor = target;
        return true;
    }

    private bool TurnPage(int direction)
    {
        var target = Page + direction;
        if (target < 0 || target >= PageCount)
        {
            return false;
        }

        var pageStart = target * PageSize;
        var pageEnd = Math.Min(pageStart + PageSize, _items.Count);

        // The first enabled line on that page, or its first line if every one is
        // disabled — a page with nothing to pick is still a page to look at.
        var landing = pageStart;
        for (var i = pageStart; i < pageEnd; i++)
        {
            if (!_items[i].Disabled)
            {
                landing = i;
                break;
            }
        }

        Cursor = landing;
        return true;
    }

    private int? FirstEnabledFrom(int index, bool forward)
    {
        var step = forward ? 1 : -1;
        for (var i = index; i >= 0 && i < _items.Count; i += step)
        {
            if (!_items[i].Disabled)
            {
                return i;
            }
        }

        return null;
    }
}
