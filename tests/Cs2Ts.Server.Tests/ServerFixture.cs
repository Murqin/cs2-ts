namespace Cs2Ts.Server.Tests;

/// <summary>
/// Starts one server for the whole suite and hands it out.
///
/// It is a collection fixture rather than a per-test one because booting a game server
/// is the expensive part and none of these tests need a clean one — they ask questions
/// rather than break things. What they do need is for the server to be running the
/// build under test, which is checked rather than assumed; see
/// <see cref="RefuseAStaleInstall"/>.
/// </summary>
public sealed class ServerFixture : IAsyncLifetime
{
    private DedicatedServer? _server;

    public async Task InitializeAsync()
    {
        if (!DedicatedServer.IsInstalled)
        {
            throw new InvalidOperationException(
                $"no CS2 dedicated server at {DedicatedServer.Root}. This suite runs a real " +
                "server on purpose; run the other suites instead if there is not one here.");
        }

        RefuseAStaleInstall();

        var scripts = Path.Combine(AppContext.BaseDirectory, "scripts");
        _server = await DedicatedServer.StartAsync(scripts);
    }

    /// <summary>The running server.</summary>
    internal DedicatedServer Require() =>
        _server ?? throw new InvalidOperationException("the server did not start");

    /// <summary>
    /// The running server, with at least one player in the world.
    ///
    /// Bots, because a suite that needs a person is a suite nobody runs. The quota is
    /// asked for here rather than at startup: given at load it does not stick, which is
    /// a thing this project has already learned twice.
    ///
    /// Nothing is remembered between calls. One of these tests kicks everybody, xunit
    /// does not promise an order, and a cached "there are players" would make the rest
    /// of the class pass or fail depending on which test ran first.
    /// </summary>
    internal async Task<DedicatedServer> RequireWithPlayersAsync()
    {
        var server = Require();
        server.Command("bot_quota 2");

        // Asked of the script rather than of the engine, because what the tests care
        // about is a player the facade can see: a bot that exists but has no pawn yet
        // fails every one of them, and it is a real state that lasts a few seconds.
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(60);
        while (DateTime.UtcNow < deadline)
        {
            server.ClearTranscript();
            server.Command("css_hplayers");

            var line = await server.WaitForAsync(
                l => l.Contains("HARNESS players=", StringComparison.Ordinal),
                TimeSpan.FromSeconds(15));

            if (!line.Contains("alive=0", StringComparison.Ordinal))
            {
                return server;
            }

            await Task.Delay(TimeSpan.FromSeconds(2));
        }

        throw new TimeoutException("no bot reached the world within a minute");
    }

    /// <summary>
    /// Refuses to run against a plugin older than the one just built.
    ///
    /// The alternative is worse than it sounds: the suite would pass, and it would be
    /// telling the truth about a binary nobody changed. A green run on the previous
    /// build is not a weaker signal, it is a wrong one.
    ///
    /// It refuses rather than publishing. Publishing would write into a server install
    /// that somebody may be using right now, and this suite already takes care not to
    /// touch anything it did not start.
    /// </summary>
    private static void RefuseAStaleInstall()
    {
        var installed = new FileInfo(Path.Combine(
            DedicatedServer.Root,
            "server/game/csgo/addons/counterstrikesharp/plugins/Cs2Ts.Plugin/Cs2Ts.Plugin.dll"));

        if (!installed.Exists)
        {
            throw new InvalidOperationException(
                $"CS2-TS is not installed on that server ({installed.FullName} is missing). " +
                "Publish it there first.");
        }

        // Walking up from the test binary rather than a path constant: the repository
        // moves, the layout does not.
        var repository = new DirectoryInfo(AppContext.BaseDirectory);
        while (repository is not null && !File.Exists(Path.Combine(repository.FullName, "Cs2Ts.slnx")))
        {
            repository = repository.Parent;
        }

        var built = repository is null
            ? null
            : new FileInfo(Path.Combine(
                repository.FullName,
                "src/Cs2Ts.Plugin/bin/Debug/net10.0/linux-x64/Cs2Ts.Plugin.dll"));

        if (built is { Exists: true } && built.LastWriteTimeUtc > installed.LastWriteTimeUtc)
        {
            throw new InvalidOperationException(
                $"the installed plugin is older than the one just built " +
                $"({installed.LastWriteTimeUtc:HH:mm:ss} against {built.LastWriteTimeUtc:HH:mm:ss}). " +
                "Publish it before running this suite:" + Environment.NewLine +
                "  dotnet publish src/Cs2Ts.Plugin -c Debug -o <scratch> && cp <scratch>/Cs2Ts.*.dll " +
                $"{Path.GetDirectoryName(installed.FullName)}/");
        }
    }

    public async Task DisposeAsync()
    {
        if (_server is not null)
        {
            await _server.DisposeAsync();
        }
    }
}

/// <summary>
/// Ties every test class here to the one server. Without it xunit runs classes in
/// parallel, and two game servers booting at once is neither faster nor honest about
/// which one a failure came from.
/// </summary>
[CollectionDefinition("dedicated server")]
public sealed class DedicatedServerCollection : ICollectionFixture<ServerFixture>;
