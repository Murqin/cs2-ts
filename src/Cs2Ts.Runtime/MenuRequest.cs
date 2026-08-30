using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// A menu as a script asked for it: the <c>MenuOptions</c> object read once into the
/// pieces <see cref="MenuTable.Open"/> needs.
///
/// The reading lives here rather than in the binding because none of it touches the
/// game — it is a ClearScript object turned into a model — so the binding stays a thin
/// wrapper and the tests exercise the same parse the server does.
/// </summary>
/// <param name="Model">The lines and the cursor.</param>
/// <param name="Style">Chat or centre.</param>
/// <param name="CloseOnSelect">Whether a pick closes the menu.</param>
/// <param name="Handlers">The <c>onSelect</c> callback per line, in order; null where there is none.</param>
public sealed record MenuRequest(
    MenuModel Model,
    MenuStyle Style,
    bool CloseOnSelect,
    IReadOnlyList<ScriptObject?> Handlers)
{
    /// <summary>
    /// Reads a script's <c>MenuOptions</c>. Throws <see cref="ArgumentException"/> with a
    /// sentence for anything missing or the wrong shape, so a bad menu fails at the
    /// <c>menu.open</c> call rather than opening something empty.
    /// </summary>
    public static MenuRequest Parse(ScriptObject options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var title = options.GetProperty("title") as string
            ?? throw new ArgumentException("a menu needs a string 'title'");

        // The engine runs with EnableArrayConversion, so a script array arrives here as
        // a native list rather than a ScriptObject. IList covers whatever concrete type
        // that is without pinning it down.
        if (options.GetProperty("items") is not System.Collections.IList rawItems || rawItems.Count == 0)
        {
            throw new ArgumentException("a menu needs a non-empty 'items' array");
        }

        var entries = new MenuEntry[rawItems.Count];
        var handlers = new ScriptObject?[rawItems.Count];
        for (var i = 0; i < rawItems.Count; i++)
        {
            if (rawItems[i] is not ScriptObject item)
            {
                throw new ArgumentException($"menu item {i} is not an object");
            }

            entries[i] = new MenuEntry(
                item.GetProperty("text") as string
                    ?? throw new ArgumentException($"menu item {i} needs a string 'text'"),
                IsTruthy(item.GetProperty("disabled")));

            handlers[i] = item.GetProperty("onSelect") as ScriptObject;
        }

        var style = (options.GetProperty("style") as string) switch
        {
            null or "chat" => MenuStyle.Chat,
            "center" => MenuStyle.Center,
            var other => throw new ArgumentException(
                $"a menu's style must be \"chat\" or \"center\", not \"{other}\""),
        };

        // Default true: only an explicit false keeps the menu up after a pick.
        var closeOnSelect = options.GetProperty("closeOnSelect") is not false;

        return new MenuRequest(new MenuModel(title, entries), style, closeOnSelect, handlers);
    }

    private static bool IsTruthy(object? value) => value switch
    {
        null or Undefined => false,
        bool flag => flag,
        _ => true,
    };
}
