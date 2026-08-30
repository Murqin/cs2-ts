using CounterStrikeSharp.API.Core;
using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Plugin;

/// <summary>
/// The <c>hud</c> global: centre-screen text a script keeps in front of a player rather
/// than flashes there once.
///
/// <c>player.sendCenter</c> sends one line the game fades after a few seconds. This is
/// the version that stays: the runtime sends it again before each fade until the script
/// clears it, the player leaves, or the plugin is unloaded. It is a global rather than a
/// method on <c>player</c> because a kept message has a lifetime and that lifetime has
/// to be the plugin's — the same reason timers are globals — while a
/// <see cref="PlayerFacade{TController,TPawn}"/> is one shared object with no plugin of
/// its own.
/// </summary>
/// <remarks>
/// Public for the reason every host API here is: ClearScript binds a host object's
/// members against the engine's access context, which a non-public type has none of.
/// Only <see cref="ScriptMemberAttribute"/> members are reachable.
/// </remarks>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class HudApi(ScriptPlugin plugin, CenterHudTable table)
{
    /// <summary>
    /// Shows a line of centre-screen HTML and keeps it there. Calling it again — from
    /// this plugin or another — replaces whatever was showing: there is one centre slot
    /// per player and the last write holds it.
    /// </summary>
    [ScriptMember("show")]
    public void Show(PlayerFacade<CCSPlayerController, CCSPlayerPawn> player, string text)
    {
        ArgumentNullException.ThrowIfNull(player);
        ArgumentNullException.ThrowIfNull(text);
        table.Show(plugin, player.Id, text);
    }

    /// <summary>
    /// Clears the centre message for a player, if this plugin is the one showing it.
    /// Clearing when there is nothing up, or when another plugin owns the slot, does
    /// nothing.
    /// </summary>
    [ScriptMember("clear")]
    public void Clear(PlayerFacade<CCSPlayerController, CCSPlayerPawn> player)
    {
        ArgumentNullException.ThrowIfNull(player);
        table.Clear(plugin, player.Id);
    }
}
