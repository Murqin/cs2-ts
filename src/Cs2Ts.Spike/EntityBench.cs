using System.Globalization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using Microsoft.ClearScript;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Spike;

/// <summary>
/// The second half of step 1: what does reaching a live entity cost?
///
/// This is the number the design cannot negotiate away. The architecture forbids
/// caching native pointers in script objects, so every property access re-resolves the
/// entity from a durable identity and validates it. That safety has a price, and the
/// price has to be known before an API is built on top of it.
/// </summary>
internal static class EntityBench
{
    /// <summary>Returns the user ids it measured, for reuse by the tick-spaced pass.</summary>
    public static int[] Run(V8ScriptEngine engine, Action<string> log, int iterations, int warmup)
    {
        var players = Utilities.GetPlayers()
            .Where(p => p is { IsValid: true, UserId: not null })
            .ToArray();

        log($"players available: {players.Length}");
        if (players.Length == 0)
        {
            log("entity bench SKIPPED: no players on the server");
            return [];
        }

        var userIds = players.Select(p => p.UserId!.Value).ToArray();
        var index = 0;
        int NextUserId() => userIds[index++ % userIds.Length];

        log("");
        log("--- entity access (each sample re-resolves; no pointer is cached) ---");

        var resolve = Measurement.TimeEach("resolve userid -> controller", iterations, warmup,
            () => _ = Utilities.GetPlayerFromUserid(NextUserId()));

        var resolveValid = Measurement.TimeEach("resolve + IsValid", iterations, warmup, () =>
        {
            var controller = Utilities.GetPlayerFromUserid(NextUserId());
            _ = controller is { IsValid: true };
        });

        var facade = new HostFacade();
        var fullChain = Measurement.TimeEach("resolve + pawn deref + health (C#)", iterations, warmup,
            () => _ = facade.Health(NextUserId()));

        foreach (var samples in new[] { resolve, resolveValid, fullChain })
        {
            log(samples.Report());
        }

        log("");
        log("--- the same read, reached from JavaScript ---");

        engine.AddHostObject("players", facade);
        engine.Execute("function readHealth(id) { return players.Health(id); }");
        var readHealth = (ScriptObject)engine.Script.readHealth;

        var fromJs = Measurement.TimeEach("js -> facade -> health", iterations, warmup,
            () => _ = readHealth.InvokeAsFunction(NextUserId()));

        log(fromJs.Report());
        log("");
        log(string.Create(
            CultureInfo.InvariantCulture,
            $"boundary share of one property read (p50) = {fromJs.Percentile(50) - fullChain.Percentile(50):F3} us of {fromJs.Percentile(50):F3} us"));

        return userIds;
    }
}
