using CounterStrikeSharp.API.Core;
using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Plugin;

/// <summary>
/// The <c>menu</c> global: a list of choices put in front of one player, in chat or in
/// the centre of the screen, with a callback per choice.
///
/// Like a timer or a kept centre message, a menu belongs to the plugin that opened it:
/// reloading the script closes it rather than leaving it on a screen with its callbacks
/// pointing at an engine that is gone. One menu per player — opening a second replaces
/// the first, because there is one screen and one chat.
///
/// The work is <see cref="MenuRequest.Parse"/> and <see cref="MenuTable"/>, both in the
/// runtime; this is the two lines that need a player and the game.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class MenuApi(ScriptPlugin plugin, MenuTable menus, Action<long, IReadOnlyList<string>> printChatMenu)
{
    /// <summary>
    /// Opens a menu for a player. Returns a handle that says whether it is still the one
    /// open and can close it. Throws with a sentence if the options are the wrong shape.
    /// </summary>
    [ScriptMember("open")]
    public OpenMenuHandle Open(PlayerFacade<CCSPlayerController, CCSPlayerPawn> player, ScriptObject options)
    {
        ArgumentNullException.ThrowIfNull(player);

        var request = MenuRequest.Parse(options);
        var id = menus.Open(
            plugin, player.Id, request.Model, request.Style, request.CloseOnSelect, request.Handlers);

        if (request.Style == MenuStyle.Chat)
        {
            printChatMenu(player.Id, request.Model.RenderChatLines());
        }

        return new OpenMenuHandle(plugin, menus, player.Id, id);
    }
}

/// <summary>
/// What <c>menu.open</c> hands back: a way to ask whether this menu is still the one the
/// player has open, and a way to close it.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class OpenMenuHandle(ScriptPlugin plugin, MenuTable menus, long playerId, long menuId)
{
    /// <summary>
    /// False once the player picked something, closed it, opened another menu, left, or
    /// the script was reloaded.
    /// </summary>
    [ScriptMember("isOpen")]
    public bool IsOpen => menus.IsOpen(playerId, menuId);

    /// <summary>Closes this menu, if it is still the open one. Closing one that is already gone does nothing.</summary>
    [ScriptMember("close")]
    public void Close() => menus.CloseById(plugin, menuId);
}
