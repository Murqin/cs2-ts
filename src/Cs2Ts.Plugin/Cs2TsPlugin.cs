using System.Diagnostics;
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
/// starts V8 safely, turns CounterStrikeSharp events into dispatches, gives the player
/// table a way to resolve players and a way to act on them, and drains queued work
/// once a tick.
/// </summary>
public sealed class Cs2TsPlugin : BasePlugin
{
    public override string ModuleName => "CS2-TS";
    public override string ModuleVersion => "0.1.0";
    public override string ModuleAuthor => "Icarus Murqin";
    public override string ModuleDescription => "TypeScript scripting for CounterStrike 2.";

    private ScriptHost? _host;
    private PlayerFacadeTable<CCSPlayerController, CCSPlayerPawn>? _players;

    // One instance, shared by the facade and the escape hatch. Both need the rule for
    // what counts as a pawn, and two copies of that rule would drift.
    private readonly CssPlayerOperations _operations = new();

    private FileSystemWatcher? _watcher;
    private bool _scriptsLoaded;
    private bool _engineChecked;
    private bool _engineIsOurs;
    private string _localeAtLoad = "";

    /// <summary>
    /// Where a server operator drops their script files: scripts/ next to the plugin,
    /// unless CS2TS_SCRIPTS names somewhere else.
    ///
    /// The override exists so that something other than the operator's own folder can
    /// be loaded — an automated run against a real server needs to choose exactly which
    /// scripts are present, and a suite that has to share a directory with whatever
    /// someone left there is a suite that fails for reasons nobody can reproduce.
    /// A relative path would be read against the server's working directory rather than
    /// the plugin's, which is not what anyone setting this means, so it is refused.
    /// </summary>
    private string ScriptDirectory
    {
        get
        {
            var configured = Environment.GetEnvironmentVariable("CS2TS_SCRIPTS");
            if (string.IsNullOrWhiteSpace(configured))
            {
                return Path.Combine(ModuleDirectory, "scripts");
            }

            if (!Path.IsPathRooted(configured))
            {
                Console.WriteLine(
                    $"[CS2-TS] CS2TS_SCRIPTS must be an absolute path; ignoring '{configured}'");
                return Path.Combine(ModuleDirectory, "scripts");
            }

            return configured;
        }
    }

    /// <summary>
    /// Both are first-class. A .js file has nothing to strip, so accepting one costs the
    /// runtime nothing — and the audience this is aimed at, people who already write
    /// Valve's cs_script, write JavaScript.
    /// </summary>
    private static readonly string[] ScriptExtensions = ["*.ts", "*.js"];

    public override void Load(bool hotReload)
    {
        // Read before anything of ours runs, so that a change made by the bootstrap or
        // by V8 itself is attributable. setlocale has one setting for the whole process
        // and LC_NUMERIC decides what a decimal point is; a library that switches it
        // changes what every printf and strtod in the server produces, including the
        // game's own, and nothing about the resulting breakage looks like a locale.
        _localeAtLoad = V8Bootstrap.CurrentLocale();

        // Before anything touches ClearScript. The CS2 server keeps Valve's own V8 in
        // the global symbol scope, and without this the first engine aborts the process
        // rather than throwing.
        if (!V8Bootstrap.Install(ModuleDirectory, message => Console.WriteLine($"[CS2-TS] {message}")))
        {
            Console.WriteLine("[CS2-TS] V8 bootstrap failed; no scripts will be loaded.");
            return;
        }

        _host = new ScriptHost(Report);
        _host.CommandRegistered = RegisterScriptCommand;
        _players = new PlayerFacadeTable<CCSPlayerController, CCSPlayerPawn>(
            "player", ResolvePlayer, _operations);
        _host.Configure = InstallApi;

        Directory.CreateDirectory(ScriptDirectory);
        AuthorSetup.Install(ScriptDirectory, message => Console.WriteLine($"[CS2-TS] {message}"));
        WatchForChanges();

        // Background work comes back here, on the game thread, once a tick.
        RegisterListener<Listeners.OnTick>(OnTick);

        // The signal that the game can answer. It has to be OnMapStart rather than a
        // tick: an empty server hibernates as soon as the map is up, and a hibernating
        // server does not tick at all, so a tick-gated load would never happen on a
        // server nobody has joined yet.
        RegisterListener<Listeners.OnMapStart>(_ => LoadScriptsOnce());

        RegisterEvents();
        RegisterCommands();
    }

    /// <summary>
    /// Runs the deferred work, and holds the first script load until the game is up.
    ///
    /// A script's top-level code runs when the plugin loads it, and at plugin-load time
    /// the game is not initialised yet. That is not a nuisance, it is a crash: reading
    /// Server.CurrentTime there segfaults the process — measured, reproducibly. A native
    /// crash is not something the script boundary can contain, because there is no
    /// managed exception to catch and no process left to report it, so the only defence
    /// is not to run script code until the game can answer.
    ///
    /// Server.MapName is the readiness probe, and it is one that was measured rather
    /// than assumed: it is null while the plugin is loading and a real name once a map
    /// is running.
    /// </summary>
    private void OnTick()
    {
        // The secondary trigger, for a plugin loaded while a map is already running:
        // OnMapStart has been and gone, but the loop is turning, so the game is up.
        LoadScriptsOnce();
        _host?.DrainFrames();
        _host?.AdvanceTimers();
    }

    /// <summary>
    /// Loads every script, once, and only once the game can answer. Both triggers call
    /// it and both run on the game thread, so the flag needs no lock.
    /// </summary>
    private void LoadScriptsOnce()
    {
        if (_scriptsLoaded || _host is null || string.IsNullOrEmpty(Server.MapName))
        {
            return;
        }

        _scriptsLoaded = true;
        LoadAll();
    }

    /// <summary>
    /// The facade table's one link to the game. It answers null for a player who has
    /// left and for one who is still around but no longer valid, because a script
    /// cannot tell those apart and should not have to.
    /// </summary>
    /// <remarks>
    /// IsValid alone is not enough, and believing it was is a bug a server found.
    /// It reports whether the entity is valid, not whether the person is here: a
    /// controller for someone who has disconnected stays valid and keeps their name and
    /// SteamID, so a handle held across their departure went on resolving to them.
    /// Measured fifteen seconds after a real disconnect: still IsValid, still the right
    /// name and SteamID, while players.all() correctly no longer listed them.
    ///
    /// Connected is the field that answers the question the handle is actually asking.
    /// Measured across the same disconnect: Connected while playing, still Connected
    /// during the player_disconnect event itself — so a handler for that event can still
    /// see who left — and Disconnected afterwards, at which point UserId has also been
    /// reset to 65535. Requiring it costs nothing and closes the window.
    /// </remarks>
    private static CCSPlayerController? ResolvePlayer(long userId)
    {
        var controller = Utilities.GetPlayerFromUserid((int)userId);
        return controller is { IsValid: true, Connected: PlayerConnectedState.Connected }
            ? controller
            : null;
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
        engine.AddHostObject("unsafe", new UnsafeApi(_operations));

        // Once, for the first engine, and silent when it passes. An operator has no
        // question this answers on a working server — the bootstrap already logged that
        // it succeeded — and a line that only ever says "the normal thing happened" is
        // the kind of noise that trains people to stop reading the log.
        //
        // It is not silent when it fails, because that failure has no other symptom:
        // nothing crashes, nothing looks wrong, and the isolation everything else here
        // assumes is simply absent.
        if (!_engineChecked)
        {
            _engineChecked = true;
            _engineIsOurs = V8Bootstrap.LooksLikeOurV8(engine);

            var localeNow = V8Bootstrap.CurrentLocale();
            if (localeNow != _localeAtLoad)
            {
                Console.WriteLine(
                    $"[CS2-TS] WARNING: the process locale changed from '{_localeAtLoad}' to '{localeNow}' " +
                    "while the scripting engine was starting. That setting is shared with the game, and " +
                    "under a locale that writes decimals with commas the server's own number parsing " +
                    "misreads values without reporting anything.");
            }

            if (!_engineIsOurs)
            {
                Console.WriteLine(
                    "[CS2-TS] WARNING: the scripting engine is not the one this plugin ships. " +
                    "Scripts are running on the game's own JavaScript engine, which is years older " +
                    "and shared with the map. Expect missing language features and no isolation. " +
                    "Check that ClearScriptV8.linux-x64.so is present next to the plugin.");
            }
        }
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
    /// Hands the script a facade rather than a controller. The controller is alive right
    /// now, inside this event; the facade is still meaningful five seconds from now,
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

    /// <summary>
    /// Puts a script's command on the server.
    ///
    /// The name gets CounterStrikeSharp's console prefix, which is also what makes the
    /// chat trigger work: typing !heal makes the client run css_heal, so a command
    /// registered under the prefix answers from chat and from the console both, and one
    /// registered without it answers from neither.
    ///
    /// Called once per name for the life of the process, from the script load that
    /// first mentioned it — on the game thread, which is where AddCommand belongs.
    /// </summary>
    private void RegisterScriptCommand(string name)
    {
        AddCommand(CommandName.ToConsoleCommand(name), $"CS2-TS script command '{name}'.", (controller, command) =>
        {
            if (_host is null)
            {
                return;
            }

            // Argument 0 is the command itself; a script asked for what came after it.
            var args = new string[Math.Max(0, command.ArgCount - 1)];
            for (var i = 0; i < args.Length; i++)
            {
                args[i] = command.GetArg(i + 1);
            }

            // Null from the server console and from RCON. The script sees null rather
            // than a stand-in, because a command that pretends someone ran it would
            // teleport nobody and report success.
            object? player = controller?.UserId is { } userId && _players is not null
                ? _players.For(userId)
                : null;

            var outcome = _host.DispatchCommand(name, player, args);
            if (outcome.Taken > 0)
            {
                // It ran. If it threw, the boundary has already said so, with the
                // script's own file and line — repeating it here would only add noise.
                return;
            }

            command.ReplyToCommand(outcome.Skipped > 0
                ? $"'{name}' is switched off after repeated errors; see the server log."
                : $"No script is handling '{name}' right now.");
        });
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

            var path = new[] { ".ts", ".js" }
                .Select(extension => Path.Combine(ScriptDirectory, requested + extension))
                .FirstOrDefault(File.Exists);

            if (path is null)
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
            Console.WriteLine($"[CS2-TS] pending timers: {_host.Timers.Count}, dropped: {_host.Timers.Dropped}");
            Console.WriteLine($"[CS2-TS] watchdog interruptions: {_host.Watchdog.Interruptions}");

            // Available to whoever asks, rather than announced to everyone who does not.
            Console.WriteLine(_engineChecked
                ? $"[CS2-TS] engine: {(_engineIsOurs ? "the one this plugin ships" : "the game's own — see the warning at load")}"
                : "[CS2-TS] engine: not started yet");
            Console.WriteLine($"[CS2-TS] process locale: {V8Bootstrap.CurrentLocale()} (was '{_localeAtLoad}' at load)");
        });
    }

    private void LoadAll()
    {
        if (_host is null)
        {
            return;
        }

        string[] found = Directory.Exists(ScriptDirectory)
            ? ScriptExtensions
                .SelectMany(pattern => Directory.GetFiles(ScriptDirectory, pattern, SearchOption.TopDirectoryOnly))
                .Where(ScriptFile.IsScript)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray()
            : [];

        // vip.ts and vip.js would both want to be "vip". Rather than let the second one
        // silently replace the first, both are refused: which one won would depend on
        // directory order, which is not something an operator can reason about.
        foreach (var clash in found
                     .GroupBy(Path.GetFileNameWithoutExtension, StringComparer.Ordinal)
                     .Where(group => group.Count() > 1)
                     .ToArray())
        {
            Console.WriteLine(
                $"[CS2-TS] '{clash.Key}' matches more than one file " +
                $"({string.Join(", ", clash.Select(Path.GetFileName))}); rename one. Neither was loaded.");
            found = found.Where(path => Path.GetFileNameWithoutExtension(path) != clash.Key).ToArray();
        }

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
            Console.WriteLine($"[CS2-TS] could not read {Path.GetFileName(path)}: {exception.Message}");
            return;
        }

        // Timed because it is the one thing a script author pays for that they cannot
        // see: stripping runs the TypeScript parser inside the CS2 process, on the game
        // thread, while the server is up. Phase 0 measured it outside that process and
        // outside DEEPBIND, so the number here is the one that counts.
        var started = Stopwatch.GetTimestamp();
        var result = _host.Load(name, Path.GetFileName(path), source);
        var elapsed = Stopwatch.GetElapsedTime(started);

        if (result.Succeeded)
        {
            Console.WriteLine(
                $"[CS2-TS] loaded {Path.GetFileName(path)} " +
                $"({source.Length / 1024.0:F1} KB in {elapsed.TotalMilliseconds:F1} ms)");
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
        // One watcher, filtered in the handler: FileSystemWatcher takes a single
        // pattern, and two watchers over one directory would double every event.
        _watcher = new FileSystemWatcher(ScriptDirectory)
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

                if (!_scriptsLoaded)
                {
                    // The game is not up yet, so the first load has not happened. It
                    // will pick this file up when it does.
                    return;
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
        void OnChanged(object _, FileSystemEventArgs e)
        {
            if (ScriptFile.IsScript(e.FullPath))
            {
                Server.NextFrame(() => Schedule(e.FullPath));
            }
        }

        _watcher.Changed += OnChanged;
        _watcher.Created += OnChanged;
        _watcher.Deleted += OnChanged;
        _watcher.Renamed += (_, e) => Server.NextFrame(() =>
        {
            if (ScriptFile.IsScript(e.OldFullPath))
            {
                Schedule(e.OldFullPath);
            }

            if (ScriptFile.IsScript(e.FullPath))
            {
                Schedule(e.FullPath);
            }
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
        _scriptsLoaded = false;
        _engineChecked = false;
        _engineIsOurs = false;

        _players?.Clear();
        _players = null;
    }
}
