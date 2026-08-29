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
public sealed partial class Cs2TsPlugin : BasePlugin
{
    public override string ModuleName => "CS2-TS";
    public override string ModuleVersion => "0.1.0";
    public override string ModuleAuthor => "Icarus Murqin";
    public override string ModuleDescription => "TypeScript scripting for CounterStrike 2.";

    /// <summary>
    /// The version of the surface a script sees: the globals, their members, and what
    /// the events carry. A plugin's <c>plugin.json</c> may name the one it was written
    /// against, and one asking for a newer surface than this is refused by name rather
    /// than left to fail at whichever global it reaches for first.
    ///
    /// It is not <see cref="ModuleVersion"/> and moves for different reasons: a fix in
    /// the binding changes that one and not this, while adding a global changes this one
    /// and not necessarily that. The minor number moves when something is added, the
    /// major when something a script could have used is gone.
    /// </summary>
    public const string ScriptApiVersion = "0.1";

    private ScriptHost? _host;
    private PlayerFacadeTable<CCSPlayerController, CCSPlayerPawn>? _players;

    // The world that is not players. It hands out one facade per entity handle, so two
    // lookups of the same weapon are the same object in script.
    private readonly CssEntities _entities = new();

    // One instance, shared by the facade and the escape hatch. Both need the rule for
    // what counts as a pawn, and two copies of that rule would drift.
    private readonly CssPlayerOperations _operations;

    // A constructor only because a field initialiser cannot see another field, and this
    // one has to: a player's two entities have fields holding other entities, and those
    // go through the same table as everything else so that one weapon is one object
    // however it was reached.
    public Cs2TsPlugin() => _operations = new CssPlayerOperations(_entities);

    private FileSystemWatcher? _watcher;

    // What discovery last found. The watcher needs it to answer "which plugin was this
    // file part of?" — and it has to be the answer from before the change, because a
    // deleted file is not on disk to be asked.
    private IReadOnlyList<PluginSource> _known = [];

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
        _host.EventRegistered = HookScriptEvent;
        _players = new PlayerFacadeTable<CCSPlayerController, CCSPlayerPawn>(
            "player", ResolvePlayer, _operations);
        _host.Configure = InstallApi;

        Directory.CreateDirectory(ScriptDirectory);
        AuthorSetup.Install(ScriptDirectory, message => Console.WriteLine($"[CS2-TS] {message}"));
        WatchForChanges();

        WarmUpEventSwitch();

        // Background work comes back here, on the game thread, once a tick.
        RegisterListener<Listeners.OnTick>(OnTick);

        // The signal that the game can answer. It has to be OnMapStart rather than a
        // tick: an empty server hibernates as soon as the map is up, and a hibernating
        // server does not tick at all, so a tick-gated load would never happen on a
        // server nobody has joined yet.
        RegisterListener<Listeners.OnMapStart>(_ => LoadScriptsOnce());

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

        // Last, so that a handler sees the results of whatever this frame already had
        // queued rather than half of it. With no script listening this is a dictionary
        // miss per plugin and no crossing into V8 at all, which is what makes it safe
        // to call unconditionally sixty-four times a second.
        _host?.Dispatch("tick");
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
        engine.AddHostObject("entities", new EntitiesApi(_entities));
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

    /// <summary>
    /// Runs the generated switch once, here, so that the first script to ask for a game
    /// event is not the one that pays for it.
    ///
    /// Measured on a server, and the first two explanations were both wrong. The first
    /// call into <c>HookGameEvent</c> costs about 890 ms and every call after it costs
    /// three. It is not CounterStrikeSharp: registering a handler directly was measured
    /// at 0.2 ms. It is not the registrations inside the switch either: a call with a
    /// name that matches nothing — which registers nothing at all — costs exactly as
    /// much as one that matches. Two hundred and seventy-three cases is simply a lot of
    /// method to compile before any of it runs, and splitting the bodies out into one
    /// method per event did not change the number.
    ///
    /// Inside a script that 890 ms is spent against the watchdog's budget, and the
    /// script that happened to mention an event first was killed mid-load every time,
    /// with the failure reported against the author's file.
    ///
    /// The name is one no event has, so nothing is hooked. Running the switch is the
    /// whole point.
    /// </summary>
    private void WarmUpEventSwitch() => HookGameEvent("cs2ts:warm-up");

    /// <summary>
    /// Hooks a game event with the server because a script asked for it.
    ///
    /// Nothing is hooked in advance. There are two hundred and seventy-three game
    /// events, and a plugin that listens for three should cost three — so the host says
    /// which names scripts have mentioned and the generated switch does the rest, once
    /// per name for the life of the process.
    ///
    /// A name no game event has is worth saying out loud. A TypeScript author already
    /// got a compile error from the declarations; a JavaScript author gets nothing, and
    /// silently registering a handler that can never fire is the same failure as a
    /// command that exists and never answers.
    /// </summary>
    private void HookScriptEvent(string name)
    {
        // The runtime's own, dispatched from the tick listener rather than by the game.
        if (name == "tick")
        {
            return;
        }

        if (!HookGameEvent(name))
        {
            Console.WriteLine(
                $"[CS2-TS] WARNING: no game event is called '{name}'. A handler registered for it " +
                "will never run. Check the spelling against the declarations.");
        }
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

            // Looked up in what is on disk now rather than in what is loaded: reloading
            // a plugin that failed to load last time is the main reason to type this.
            _known = PluginDiscovery.Find(
                ScriptDirectory, ScriptApiVersion, message => Console.WriteLine($"[CS2-TS] {message}"));
            var source = _known.FirstOrDefault(plugin => plugin.Name == requested);

            if (source is null)
            {
                Console.WriteLine($"[CS2-TS] no such script: {requested}");
                return;
            }

            LoadPlugin(source);
        });

        AddCommand("cs2ts_status", "Lists loaded CS2-TS scripts.", (_, _) =>
        {
            if (_host is null)
            {
                Console.WriteLine("[CS2-TS] not running");
                return;
            }

            // Named as they describe themselves, with the version a bug report needs.
            var listed = _host.Loaded
                .Select(name => _known.FirstOrDefault(plugin => plugin.Name == name)?.Describe() ?? name);

            Console.WriteLine($"[CS2-TS] {_host.Loaded.Count} script(s): {string.Join(", ", listed)}");
            Console.WriteLine($"[CS2-TS] script API: {ScriptApiVersion}");
            Console.WriteLine($"[CS2-TS] queued frames: {_host.Frames.Count}, dropped: {_host.Frames.Dropped}");
            Console.WriteLine($"[CS2-TS] pending timers: {_host.Timers.Count}, dropped: {_host.Timers.Dropped}");
            Console.WriteLine($"[CS2-TS] entities handed out: {_entities.Count}");
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

        var found = PluginDiscovery.Find(
            ScriptDirectory, ScriptApiVersion, message => Console.WriteLine($"[CS2-TS] {message}"));
        _known = found;

        var onDisk = found.Select(plugin => plugin.Name).ToHashSet(StringComparer.Ordinal);

        // A plugin whose files were deleted while the server ran is still loaded until
        // someone says otherwise, so reloading everything has to mean removals too.
        foreach (var name in _host.Loaded.Where(name => !onDisk.Contains(name)).ToArray())
        {
            _host.Unload(name);
            Console.WriteLine($"[CS2-TS] unloaded {name} (it is gone)");
        }

        foreach (var plugin in found)
        {
            LoadPlugin(plugin);
        }
    }

    private void LoadPlugin(PluginSource source)
    {
        if (_host is null)
        {
            return;
        }

        string text;
        try
        {
            text = File.ReadAllText(source.EntryPath);
        }
        catch (IOException exception)
        {
            // A save in progress is the usual reason. The watcher will fire again.
            Console.WriteLine($"[CS2-TS] could not read {source.DisplayName}: {exception.Message}");
            return;
        }

        // Timed because it is the one thing a script author pays for that they cannot
        // see: stripping runs the TypeScript parser inside the CS2 process, on the game
        // thread, while the server is up. Phase 0 measured it outside that process and
        // outside DEEPBIND, so the number here is the one that counts. A folder plugin
        // pays for its modules too, and they are stripped from inside this call.
        var started = Stopwatch.GetTimestamp();
        var result = _host.Load(source, text);
        var elapsed = Stopwatch.GetElapsedTime(started);

        if (result.Succeeded)
        {
            // A folder plugin says which version of itself this is; a single file has no
            // manifest and its file name is already the whole of what there is to say.
            var version = source.Manifest is { } manifest ? $" v{manifest.Version}" : "";

            Console.WriteLine(
                $"[CS2-TS] loaded {source.DisplayName}{version} " +
                $"({text.Length / 1024.0:F1} KB in {elapsed.TotalMilliseconds:F1} ms)");
            return;
        }

        foreach (var line in result.Report())
        {
            Console.WriteLine($"[CS2-TS] {line}");
        }
    }

    /// <summary>
    /// Reloads whatever plugin a changed path belongs to.
    ///
    /// Discovery runs again first, because the change may have made a plugin, unmade
    /// one, or settled a name clash that was refusing two. Ownership is then asked
    /// twice: of what was there before the change, so that a deleted file still names
    /// the plugin it was part of, and of what is there now.
    /// </summary>
    private void Reload(string path)
    {
        if (_host is null)
        {
            return;
        }

        var owned = PluginDiscovery.Owning(_known, path);

        _known = PluginDiscovery.Find(
            ScriptDirectory, ScriptApiVersion, message => Console.WriteLine($"[CS2-TS] {message}"));
        var owner = PluginDiscovery.Owning(_known, path);

        if (owner is not null)
        {
            LoadPlugin(owner);
            return;
        }

        // Nothing owns it now. Either it was a plugin and is gone, or it was never one
        // — an editor's scratch file two folders down, which is why this says nothing
        // when there was nothing to unload.
        if (owned is not null && _host.Unload(owned.Name))
        {
            Console.WriteLine($"[CS2-TS] unloaded {owned.Name} (it is gone)");
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

            // A plugin is a folder, so a save two levels down is a change to that
            // plugin. Without this the whole point of folders — split your plugin up —
            // would come with "and restart the server to see it".
            IncludeSubdirectories = true,
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

                Reload(path);
            });
        }

        // A script, or something with no extension — which is what a folder looks like,
        // including one that has just been deleted and cannot be asked what it was.
        // Everything else in a plugin folder is the author's own business.
        static bool Interesting(string path) =>
            ScriptFile.IsScript(path) || !Path.HasExtension(path);

        // AddTimer must be called from the game thread, so the hop happens first.
        void OnChanged(object _, FileSystemEventArgs e)
        {
            if (Interesting(e.FullPath))
            {
                Server.NextFrame(() => Schedule(e.FullPath));
            }
        }

        _watcher.Changed += OnChanged;
        _watcher.Created += OnChanged;
        _watcher.Deleted += OnChanged;
        _watcher.Renamed += (_, e) => Server.NextFrame(() =>
        {
            if (Interesting(e.OldFullPath))
            {
                Schedule(e.OldFullPath);
            }

            if (Interesting(e.FullPath))
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

        _entities.Clear();
    }
}
