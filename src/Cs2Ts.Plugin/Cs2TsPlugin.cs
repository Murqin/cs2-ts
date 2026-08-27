using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Commands;
using Cs2Ts.Runtime;

namespace Cs2Ts.Plugin;

/// <summary>
/// The CounterStrikeSharp plugin that hosts CS2-TS.
///
/// Everything with logic in it lives in Cs2Ts.Runtime, which knows nothing about
/// CounterStrikeSharp and is tested without a server. This class is the binding: it
/// starts V8 safely, turns CounterStrikeSharp events into dispatches, gives the handle
/// table a way to resolve players, and drains queued work once a tick.
/// </summary>
public sealed class Cs2TsPlugin : BasePlugin
{
    public override string ModuleName => "CS2-TS";
    public override string ModuleVersion => "0.1.0";
    public override string ModuleAuthor => "Icarus Murqin";
    public override string ModuleDescription => "TypeScript scripting for CounterStrike 2.";

    private ScriptHost? _host;
    private EntityHandleTable<CCSPlayerController>? _players;
    private FileSystemWatcher? _watcher;

    /// <summary>Where a server operator drops their <c>.ts</c> files.</summary>
    private string ScriptDirectory => Path.Combine(ModuleDirectory, "scripts");

    public override void Load(bool hotReload)
    {
        // Before anything touches ClearScript. The CS2 server keeps Valve's own V8 in
        // the global symbol scope, and without this the first engine aborts the process
        // rather than throwing.
        if (!V8Bootstrap.Install(ModuleDirectory, message => Console.WriteLine($"[CS2-TS] {message}")))
        {
            Console.WriteLine("[CS2-TS] V8 bootstrap failed; no scripts will be loaded.");
            return;
        }

        _host = new ScriptHost(Report);
        _players = new EntityHandleTable<CCSPlayerController>("player", ResolvePlayer);
        _host.Configure = InstallApi;

        Directory.CreateDirectory(ScriptDirectory);
        LoadAll();
        WatchForChanges();

        // Background work comes back here, on the game thread, once a tick.
        RegisterListener<Listeners.OnTick>(() => _host?.DrainFrames());

        RegisterEvents();
        RegisterCommands();
    }

    /// <summary>
    /// The handle table's one link to the game. It answers null for a player who has
    /// left and for one who is still around but no longer valid, because a script
    /// cannot tell those apart and should not have to.
    /// </summary>
    private static CCSPlayerController? ResolvePlayer(long userId)
    {
        var controller = Utilities.GetPlayerFromUserid((int)userId);
        return controller is { IsValid: true } ? controller : null;
    }

    /// <summary>
    /// Installs the globals a plugin gets. Called for each engine before its code runs,
    /// so a plugin can use these at its top level.
    /// </summary>
    private void InstallApi(ScriptPlugin plugin, Microsoft.ClearScript.V8.V8ScriptEngine engine)
    {
        engine.AddHostObject("server", new ServerApi(plugin, _host!.Frames));
        engine.AddHostObject("console", new ConsoleApi(plugin.Name, Console.WriteLine));
        engine.AddHostObject("players", new PlayersApi(_players!));
    }

    private void RegisterEvents()
    {
        // A deliberately short list. The facade is meant to stay behind
        // CounterStrikeSharp's surface, and events are added when something needs them
        // rather than in advance.
        RegisterEventHandler<EventRoundStart>((@event, _) =>
        {
            _host?.Dispatch("round_start", @event.Timelimit);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventRoundEnd>((@event, _) =>
        {
            _host?.Dispatch("round_end", @event.Winner);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventPlayerConnectFull>((@event, _) =>
        {
            DispatchForPlayer("player_connect", @event.Userid);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventPlayerDisconnect>((@event, _) =>
        {
            DispatchForPlayer("player_disconnect", @event.Userid);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventPlayerDeath>((@event, _) =>
        {
            DispatchForPlayer("player_death", @event.Userid);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventPlayerSpawn>((@event, _) =>
        {
            DispatchForPlayer("player_spawn", @event.Userid);
            return HookResult.Continue;
        });
    }

    /// <summary>
    /// Hands the script a handle rather than a controller. The controller is alive right
    /// now, inside this event; the handle is still meaningful five seconds from now,
    /// which is when a script is likely to look at it.
    /// </summary>
    private void DispatchForPlayer(string eventName, CCSPlayerController? controller)
    {
        if (_host is null || _players is null || controller?.UserId is not { } userId)
        {
            return;
        }

        _host.Dispatch(eventName, _players.For(userId));
    }

    private void RegisterCommands()
    {
        AddCommand("cs2ts_reload", "Reloads one CS2-TS script, or all of them.", (_, command) =>
        {
            if (_host is null)
            {
                return;
            }

            var requested = command.ArgCount > 1 ? command.GetArg(1) : null;
            if (string.IsNullOrWhiteSpace(requested))
            {
                LoadAll();
                Console.WriteLine($"[CS2-TS] reloaded {_host.Loaded.Count} script(s)");
                return;
            }

            var path = Path.Combine(ScriptDirectory, $"{requested}.ts");
            if (!File.Exists(path))
            {
                Console.WriteLine($"[CS2-TS] no such script: {requested}");
                return;
            }

            LoadFile(path);
        });

        AddCommand("cs2ts_status", "Lists loaded CS2-TS scripts.", (_, _) =>
        {
            if (_host is null)
            {
                Console.WriteLine("[CS2-TS] not running");
                return;
            }

            Console.WriteLine($"[CS2-TS] {_host.Loaded.Count} script(s): {string.Join(", ", _host.Loaded)}");
            Console.WriteLine($"[CS2-TS] queued frames: {_host.Frames.Count}, dropped: {_host.Frames.Dropped}");
            Console.WriteLine($"[CS2-TS] watchdog interruptions: {_host.Watchdog.Interruptions}");
        });
    }

    private void LoadAll()
    {
        if (_host is null)
        {
            return;
        }

        string[] found = Directory.Exists(ScriptDirectory)
            ? Directory.GetFiles(ScriptDirectory, "*.ts", SearchOption.TopDirectoryOnly)
            : [];

        var onDisk = found.Select(path => Path.GetFileNameWithoutExtension(path)).ToHashSet(StringComparer.Ordinal);

        // A script whose file was deleted while the server ran is still loaded until
        // someone says otherwise, so reloading everything has to mean removals too.
        foreach (var name in _host.Loaded.Where(name => !onDisk.Contains(name)).ToArray())
        {
            _host.Unload(name);
            Console.WriteLine($"[CS2-TS] unloaded {name} (file is gone)");
        }

        foreach (var path in found)
        {
            LoadFile(path);
        }
    }

    private void LoadFile(string path)
    {
        if (_host is null)
        {
            return;
        }

        var name = Path.GetFileNameWithoutExtension(path);
        string source;
        try
        {
            source = File.ReadAllText(path);
        }
        catch (IOException exception)
        {
            // A save in progress is the usual reason. The watcher will fire again.
            Console.WriteLine($"[CS2-TS] could not read {name}.ts: {exception.Message}");
            return;
        }

        var result = _host.Load(name, Path.GetFileName(path), source);
        if (result.Succeeded)
        {
            Console.WriteLine($"[CS2-TS] loaded {name}.ts");
            return;
        }

        foreach (var line in result.Report())
        {
            Console.WriteLine($"[CS2-TS] {line}");
        }
    }

    /// <summary>
    /// Reloads a script when its file changes.
    ///
    /// The watcher's callbacks arrive on a thread pool thread, and everything the reload
    /// touches — V8, the game — belongs to the game thread, so the work is handed back
    /// through Server.NextFrame rather than done where it was noticed. Editors write a
    /// file in several steps, so the reload is deferred slightly and a burst of events
    /// collapses into one load.
    /// </summary>
    private void WatchForChanges()
    {
        _watcher = new FileSystemWatcher(ScriptDirectory, "*.ts")
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
            EnableRaisingEvents = true,
        };

        var pending = new HashSet<string>();

        void Schedule(string path)
        {
            lock (pending)
            {
                if (!pending.Add(path))
                {
                    return;
                }
            }

            AddTimer(0.5f, () =>
            {
                lock (pending)
                {
                    pending.Remove(path);
                }

                if (File.Exists(path))
                {
                    LoadFile(path);
                }
                else if (_host is not null && _host.Unload(Path.GetFileNameWithoutExtension(path)))
                {
                    Console.WriteLine($"[CS2-TS] unloaded {Path.GetFileNameWithoutExtension(path)} (file is gone)");
                }
            });
        }

        // AddTimer must be called from the game thread, so the hop happens first.
        void OnChanged(object _, FileSystemEventArgs e) => Server.NextFrame(() => Schedule(e.FullPath));

        _watcher.Changed += OnChanged;
        _watcher.Created += OnChanged;
        _watcher.Deleted += OnChanged;
        _watcher.Renamed += (_, e) => Server.NextFrame(() =>
        {
            Schedule(e.OldFullPath);
            Schedule(e.FullPath);
        });
    }

    private static void Report(ScriptError error)
    {
        Console.WriteLine($"[CS2-TS] {error}");

        if (error.StackTrace is not null)
        {
            Console.WriteLine(error.StackTrace);
        }
    }

    public override void Unload(bool hotReload)
    {
        _watcher?.Dispose();
        _watcher = null;

        _host?.Dispose();
        _host = null;

        _players?.Clear();
        _players = null;
    }
}
