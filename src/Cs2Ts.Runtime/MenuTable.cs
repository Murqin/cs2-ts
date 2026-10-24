using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>Which way an open centre menu was nudged.</summary>
public enum MenuNav
{
    /// <summary>Move the highlight towards the top.</summary>
    Up,

    /// <summary>Move the highlight towards the bottom.</summary>
    Down,

    /// <summary>Choose the highlighted line.</summary>
    Select,
}

/// <summary>
/// A line was chosen. <paramref name="Index"/> is its position in the original item
/// list; <paramref name="Handler"/> is the script callback for it, which may be absent —
/// an item without <c>onSelect</c> still closes the menu. The handler is handed back
/// rather than called here so the binding can run it inside the owner's boundary, the
/// way a command handler runs.
/// </summary>
public readonly record struct MenuSelection(ScriptPlugin Owner, int Index, ScriptObject? Handler);

/// <summary>
/// What one press did to a menu.
/// </summary>
/// <param name="Handled">
/// The press belonged to the menu. For a chat menu this is the signal to swallow the
/// line so the digit does not land in chat.
/// </param>
/// <param name="Redraw">A chat menu's page changed and its lines need printing again.</param>
/// <param name="Selection">A line was chosen; dispatch this.</param>
/// <param name="Closed">The menu is gone now — Exit, or a pick with closeOnSelect.</param>
public readonly record struct MenuFeed(
    bool Handled,
    bool Redraw = false,
    MenuSelection? Selection = null,
    bool Closed = false);

/// <summary>
/// The one menu a player has open, owned by the plugin that opened it.
///
/// Like <see cref="TimerTable"/> and <see cref="CenterHudTable"/>, a menu belongs to its
/// plugin: unloading or reloading closes it, so a reload does not leave the previous
/// version's menu on a screen with its callbacks pointing at a dead engine. One menu per
/// player — opening a second replaces the first, because there is one screen and one
/// chat.
///
/// A centre menu is re-sent on a schedule the way a kept centre message is: the game
/// fades it otherwise. A chat menu is printed once by the binding when it opens and
/// again when its page turns.
/// </summary>
public sealed class MenuTable
{
    // A centre menu is re-sent every tick while it is open. CS2's centre-HTML message
    // plays its fade-in from the start on every send, so a slower cadence — the one
    // second a kept hud.show message uses — shows as a pulse once a second rather than a
    // steady panel, and at worst never resolves past the fade-in. Every working CS2
    // centre-HTML menu re-sends per tick for this reason. It only costs a usermessage
    // per tick per player with a menu open, which is rare and brief.
    private const double RefreshSeconds = 0.0;

    private readonly Lock _gate = new();
    private readonly Dictionary<long, Entry> _live = [];
    private long _nextId = 1;

    /// <summary>Menus dropped because their player left or their plugin was unloaded. Diagnostics.</summary>
    public long Dropped { get; private set; }

    /// <summary>How many players have a menu open. Diagnostics.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _live.Count;
            }
        }
    }

    /// <summary>
    /// Opens a menu for a player, replacing whatever they had open. Returns an id the
    /// caller's handle uses to ask whether this menu is still the open one.
    /// </summary>
    /// <param name="owner">The plugin the menu belongs to.</param>
    /// <param name="playerId">The player's identity — their userid.</param>
    /// <param name="model">The lines and the cursor.</param>
    /// <param name="style">Chat or centre.</param>
    /// <param name="closeOnSelect">Whether a pick closes the menu.</param>
    /// <param name="handlers">
    /// One entry per line, in the model's order — the <c>onSelect</c> callback or null.
    /// </param>
    public long Open(
        ScriptPlugin owner,
        long playerId,
        MenuModel model,
        MenuStyle style,
        bool closeOnSelect,
        IReadOnlyList<ScriptObject?> handlers)
    {
        ArgumentNullException.ThrowIfNull(owner);
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(handlers);

        if (handlers.Count != model.Count)
        {
            throw new ArgumentException(
                $"expected {model.Count} handlers for {model.Count} items, got {handlers.Count}",
                nameof(handlers));
        }

        lock (_gate)
        {
            var id = _nextId++;
            _live[playerId] = new Entry(id, owner, model, style, closeOnSelect, handlers);
            return id;
        }
    }

    /// <summary>Closes a player's menu if this plugin opened it. False if there is none, or another plugin owns it.</summary>
    public bool Close(ScriptPlugin owner, long playerId)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            if (_live.TryGetValue(playerId, out var entry) && ReferenceEquals(entry.Owner, owner))
            {
                _live.Remove(playerId);
                return true;
            }

            return false;
        }
    }

    /// <summary>Closes a specific menu, by the id <see cref="Open"/> returned, if it is still the open one.</summary>
    public bool CloseById(ScriptPlugin owner, long menuId)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            var found = _live.FirstOrDefault(pair => pair.Value.Id == menuId);
            if (found.Value is { } entry && ReferenceEquals(entry.Owner, owner))
            {
                _live.Remove(found.Key);
                return true;
            }

            return false;
        }
    }

    /// <summary>Whether <paramref name="menuId"/> is the menu the player currently has open.</summary>
    public bool IsOpen(long playerId, long menuId)
    {
        lock (_gate)
        {
            return _live.TryGetValue(playerId, out var entry) && entry.Id == menuId;
        }
    }

    /// <summary>The style of the player's open menu, or null when they have none.</summary>
    public MenuStyle? StyleFor(long playerId)
    {
        lock (_gate)
        {
            return _live.TryGetValue(playerId, out var entry) ? entry.Style : null;
        }
    }

    /// <summary>The chat lines for the player's open chat menu, or null when it is not that.</summary>
    public IReadOnlyList<string>? ChatLinesFor(long playerId)
    {
        lock (_gate)
        {
            return _live.TryGetValue(playerId, out var entry) && entry.Style == MenuStyle.Chat
                ? entry.Model.RenderChatLines()
                : null;
        }
    }

    /// <summary>Forgets every menu belonging to one plugin. Called while unloading.</summary>
    public int Discard(ScriptPlugin owner)
    {
        ArgumentNullException.ThrowIfNull(owner);

        lock (_gate)
        {
            var doomed = _live
                .Where(pair => ReferenceEquals(pair.Value.Owner, owner))
                .Select(pair => pair.Key)
                .ToArray();

            foreach (var id in doomed)
            {
                _live.Remove(id);
            }

            Dropped += doomed.Length;
            return doomed.Length;
        }
    }

    /// <summary>
    /// Feeds a digit the player typed to their chat menu. Returns what it did — and
    /// whether to swallow the line, which is <see cref="MenuFeed.Handled"/>.
    /// </summary>
    public MenuFeed FeedDigit(long playerId, int digit)
    {
        lock (_gate)
        {
            if (!_live.TryGetValue(playerId, out var entry) || entry.Style != MenuStyle.Chat)
            {
                return default;
            }

            switch (digit)
            {
                case 0:
                    _live.Remove(playerId);
                    return new MenuFeed(Handled: true, Closed: true);

                case 8:
                    return new MenuFeed(Handled: true, Redraw: entry.Model.NextPage());

                case 9:
                    return new MenuFeed(Handled: true, Redraw: entry.Model.PrevPage());

                case >= 1 and <= MenuModel.PageSize:
                    return Choose(playerId, entry, entry.Model.SelectOnPage(digit));

                default:
                    // A digit with no line — still the menu's, so it does not reach chat.
                    return new MenuFeed(Handled: true);
            }
        }
    }

    /// <summary>Feeds a W/S/E press to the player's centre menu.</summary>
    public MenuFeed FeedNav(long playerId, MenuNav nav)
    {
        lock (_gate)
        {
            if (!_live.TryGetValue(playerId, out var entry) || entry.Style != MenuStyle.Center)
            {
                return default;
            }

            switch (nav)
            {
                case MenuNav.Up:
                    if (entry.Model.CursorUp())
                    {
                        entry.DueAt = double.NegativeInfinity;
                    }

                    return new MenuFeed(Handled: true);

                case MenuNav.Down:
                    if (entry.Model.CursorDown())
                    {
                        entry.DueAt = double.NegativeInfinity;
                    }

                    return new MenuFeed(Handled: true);

                case MenuNav.Select:
                    return Choose(playerId, entry, entry.Model.SelectAtCursor());

                default:
                    return new MenuFeed(Handled: true);
            }
        }
    }

    /// <summary>
    /// Re-sends every centre menu that has come due, and returns how many were sent.
    /// Call once per tick, on the game thread. Chat menus are not touched here — the
    /// binding prints those.
    /// </summary>
    /// <param name="now">The caller's monotonic clock — the one timers use.</param>
    /// <param name="render">
    /// Draws one menu's HTML for one player and answers whether they were there for it;
    /// a false answer drops the menu, the same as a player who has left.
    /// </param>
    public int Tick(double now, Func<long, string, bool> render)
    {
        ArgumentNullException.ThrowIfNull(render);

        (long Id, Entry Entry)[] due;
        lock (_gate)
        {
            due = _live
                .Where(pair => pair.Value.Style == MenuStyle.Center && pair.Value.DueAt <= now)
                .Select(pair => (pair.Key, pair.Value))
                .ToArray();
        }

        if (due.Length == 0)
        {
            return 0;
        }

        var sent = 0;
        foreach (var (id, entry) in due)
        {
            var html = entry.Model.RenderCenterHtml();
            var delivered = render(id, html);

            lock (_gate)
            {
                if (!_live.TryGetValue(id, out var current) || !ReferenceEquals(current, entry))
                {
                    if (delivered)
                    {
                        sent++;
                    }

                    continue;
                }

                if (delivered)
                {
                    current.DueAt = now + RefreshSeconds;
                    sent++;
                }
                else
                {
                    _live.Remove(id);
                    Dropped++;
                }
            }
        }

        return sent;
    }

    // Called under _gate.
    private MenuFeed Choose(long playerId, Entry entry, int flatIndex)
    {
        if (flatIndex < 0)
        {
            // A disabled line, or an empty slot. The press was the menu's; nothing picked.
            return new MenuFeed(Handled: true);
        }

        var selection = new MenuSelection(entry.Owner, flatIndex, entry.Handlers[flatIndex]);

        if (entry.CloseOnSelect)
        {
            _live.Remove(playerId);
        }

        return new MenuFeed(Handled: true, Selection: selection, Closed: entry.CloseOnSelect);
    }

    private sealed class Entry(
        long id,
        ScriptPlugin owner,
        MenuModel model,
        MenuStyle style,
        bool closeOnSelect,
        IReadOnlyList<ScriptObject?> handlers)
    {
        public long Id { get; } = id;

        public ScriptPlugin Owner { get; } = owner;

        public MenuModel Model { get; } = model;

        public MenuStyle Style { get; } = style;

        public bool CloseOnSelect { get; } = closeOnSelect;

        public IReadOnlyList<ScriptObject?> Handlers { get; } = handlers;

        // Centre menus only: re-sent once now passes this. Negative infinity so the
        // first tick after opening, and the first after the highlight moves, draws it.
        public double DueAt { get; set; } = double.NegativeInfinity;
    }
}
