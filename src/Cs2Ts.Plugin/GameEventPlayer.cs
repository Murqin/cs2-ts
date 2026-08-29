using CounterStrikeSharp.API.Core;
using Cs2Ts.Runtime;

namespace Cs2Ts.Plugin;

/// <summary>
/// Turns an event's player into something a script can keep.
///
/// CounterStrikeSharp has already resolved the event's raw userid to a controller by the
/// time a handler sees it, and a controller is exactly what a script must not be given:
/// it is alive for the length of this callback, while the thing an author will put in a
/// timer, a Map or a closure has to outlive it. A facade is an identity — it stops
/// resolving instead of pointing at freed memory.
/// </summary>
internal static class GameEventPlayer
{
    /// <summary>
    /// The facade for an event's player, or null.
    ///
    /// Null is a real answer and not an error. A kill by the world has no attacker, a
    /// field the event did not carry reads as nothing, and an event that arrives before
    /// the facade table exists — during load — has nowhere to look it up.
    /// </summary>
    internal static PlayerFacade<CCSPlayerController, CCSPlayerPawn>? For(
        CCSPlayerController? controller,
        PlayerFacadeTable<CCSPlayerController, CCSPlayerPawn>? players) =>
        players is not null && controller?.UserId is { } userId ? players.For(userId) : null;
}
