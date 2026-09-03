using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Plugin;

/// <summary>
/// The <c>server</c> global. Deliberately small: every capability a script gets has to
/// be written here, and a capability that is not written here does not exist.
/// </summary>
/// <remarks>
/// Public because ClearScript binds a host object's members against the engine's access
/// context, and a non-public type has none. Only members marked
/// <see cref="ScriptMemberAttribute"/> are reachable from script.
/// </remarks>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class ServerApi(ScriptPlugin plugin, FrameQueue frames)
{
    /// <summary>
    /// Runs a callback on the game thread. The return path for background work, and the
    /// only direction that exists — the game thread never waits on a worker.
    ///
    /// The callback is queued against this plugin, so unloading the plugin drops it
    /// instead of running it against a context that is gone.
    /// </summary>
    [ScriptMember("nextFrame")]
    public void NextFrame(ScriptObject callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        frames.Post(plugin, "server.nextFrame", () => callback.InvokeAsFunction());
    }

    /// <summary>Runs a server console command.</summary>
    [ScriptMember("command")]
    public void Command(string command)
    {
        ArgumentException.ThrowIfNullOrEmpty(command);
        Server.ExecuteCommand(command);
    }

    /// <summary>The map currently running.</summary>
    [ScriptMember("mapName")]
    public string MapName => Server.MapName;

    /// <summary>Seconds since the server started.</summary>
    [ScriptMember("currentTime")]
    public float CurrentTime => Server.CurrentTime;
}

/// <summary>
/// The <c>console</c> global. Bare V8 has no console at all, so this is a host API like
/// any other; it exists early because a plugin author's first move is to print something.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class ConsoleApi(string pluginName, Action<string> write)
{
    [ScriptMember("log")]
    public void Log(object? value) => write($"[{pluginName}] {Describe(value)}");

    [ScriptMember("warn")]
    public void Warn(object? value) => write($"[{pluginName}] warning: {Describe(value)}");

    [ScriptMember("error")]
    public void Error(object? value) => write($"[{pluginName}] error: {Describe(value)}");

    private static string Describe(object? value) => value switch
    {
        null => "null",
        Undefined => "undefined",
        _ => value.ToString() ?? "",
    };
}

/// <summary>
/// The <c>players</c> global. Hands out facades, never controllers: what a script keeps
/// is an identity that stops resolving when the player leaves.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class PlayersApi(PlayerFacadeTable<CCSPlayerController, CCSPlayerPawn> table)
{
    /// <summary>The player for a userid, whether or not they are here now.</summary>
    [ScriptMember("byUserId")]
    public PlayerFacade<CCSPlayerController, CCSPlayerPawn> ByUserId(int userId) => table.For(userId);

    /// <summary>Everyone currently connected.</summary>
    [ScriptMember("all")]
    public PlayerFacade<CCSPlayerController, CCSPlayerPawn>[] All() =>
        Utilities.GetPlayers()
            .Where(p => p is { IsValid: true, UserId: not null })
            .Select(p => table.For(p.UserId!.Value))
            .ToArray();

    /// <summary>
    /// The connected players a target specifier picks out: <c>@all</c>, <c>@ct</c>,
    /// <c>@t</c>, <c>@spec</c>, <c>@me</c>, <c>@!me</c>, <c>@bots</c>, <c>@humans</c>,
    /// <c>@alive</c>, <c>@dead</c>, <c>#&lt;userid&gt;</c>, or part of a name.
    ///
    /// <paramref name="caller"/> is what makes <c>@me</c> and <c>@!me</c> mean anything:
    /// pass the command handler's first argument straight through, and <c>null</c> from
    /// the console is handled the way the specifiers expect. An unknown <c>@</c> keyword
    /// throws — the parse lives in <see cref="TargetQuery"/>, which is where the reason
    /// is written down.
    /// </summary>
    [ScriptMember("select")]
    public PlayerFacade<CCSPlayerController, CCSPlayerPawn>[] Select(string spec, object? caller = null) =>
        TargetQuery.Parse(spec).Filter(All(), CallerId(caller));

    private static long? CallerId(object? caller) =>
        caller is PlayerFacade<CCSPlayerController, CCSPlayerPawn> player ? player.Id : null;
}

/// <summary>
/// The <c>entities</c> global: everything in the world that is not a player.
///
/// Players get their own global because they are the thing a gamemode is mostly about
/// and because a userid outlives every entity a player has. Everything else — the
/// planted bomb, a dropped weapon, a door, a prop a script made a second ago — is
/// reached from here, and what comes back is the same kind of object a player's pawn is.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class EntitiesApi(CssEntities entities)
{
    /// <summary>The entity in a slot, or null when the slot is empty.</summary>
    [ScriptMember("byIndex")]
    public EntityFacade? ByIndex(int index) => entities.ByIndex(index);

    /// <summary>Every entity whose classname is exactly this. Empty when there are none.</summary>
    [ScriptMember("find")]
    public EntityFacade[] Find(string designerName) => entities.Find(designerName);

    /// <summary>The first entity with this classname, or null.</summary>
    [ScriptMember("first")]
    public EntityFacade? First(string designerName) => entities.Find(designerName).FirstOrDefault();

    /// <summary>Everything in the world right now. A long list; see the declarations.</summary>
    [ScriptMember("all")]
    public EntityFacade[] All() => entities.All();

    /// <summary>
    /// Makes an entity, not yet in the world. Throws if the game will not make one of
    /// those, because the alternative is a script that quietly does nothing.
    /// </summary>
    [ScriptMember("create")]
    public EntityFacade Create(string designerName) => entities.Create(designerName);
}
