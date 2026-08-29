using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace Cs2Ts.Server.Tests;

/// <summary>
/// A real CS2 dedicated server, started by the test run and answering to it.
///
/// This exists because of what the rest of the suite cannot reach. Everything in
/// Cs2Ts.Runtime is tested against a fake game, and that fake is written to the same
/// contract the real binding claims to implement — so when the binding is wrong, every
/// test still passes. It has happened: isValid reported true for a player who had left,
/// the fake resolver did the right thing, and only a server disagreed. The escape hatch
/// has never had a test that was not a person typing into a console.
///
/// The cost turned out to be smaller than the design assumed, and it is worth writing
/// down because it decides how this suite gets used: the whole thing runs in about
/// twelve seconds, server boot included, against a warm page cache. The first boot
/// after a reboot is slower. That is cheap enough to run before every commit rather
/// than only before a merge.
/// </summary>
internal sealed class DedicatedServer : IAsyncDisposable
{
    /// <summary>
    /// Where the server lives. Not discovered and not configurable: a test that goes
    /// looking for a game install could find the wrong one, and the failure would be a
    /// suite that quietly tests somebody else's build.
    /// </summary>
    public const string Root = "/mnt/depot/CS2-SERVER";

    private const string Password = "cs2ts-harness";

    private readonly Process _process;
    private readonly List<string> _transcript = [];
    private readonly Lock _gate = new();

    private DedicatedServer(Process process, int port)
    {
        _process = process;
        Port = port;
    }

    /// <summary>The port this server was given. Never the default one.</summary>
    public int Port { get; }

    /// <summary>Everything the server has printed, in order.</summary>
    public IReadOnlyList<string> Transcript
    {
        get
        {
            lock (_gate)
            {
                return [.. _transcript];
            }
        }
    }

    /// <summary>Whether a server can be started here at all.</summary>
    public static bool IsInstalled => File.Exists(Path.Combine(Root, "server", "game", "cs2.sh"));

    /// <summary>
    /// Starts a server with only <paramref name="scriptDirectory"/> loaded, and waits
    /// until the plugin has finished loading scripts.
    /// </summary>
    public static async Task<DedicatedServer> StartAsync(string scriptDirectory, CancellationToken token = default)
    {
        var port = FreePort();

        // Through cs2.sh rather than the binary: the launcher sets LD_LIBRARY_PATH so
        // libserver.so can find the game's own libv8, and without it the process dies
        // before anything of ours runs.
        var start = new ProcessStartInfo(Path.Combine(Root, "server", "game", "cs2.sh"))
        {
            WorkingDirectory = Path.Combine(Root, "server", "game"),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };

        // -ip binds to loopback, which does two things: it keeps a test server off the
        // network, and it puts the RCON listener somewhere a test can reach it. Left
        // alone that listener binds to the machine's LAN address instead.
        foreach (var argument in new[]
                 {
                     "-dedicated", "-console", "-usercon",
                     "-ip", "127.0.0.1", "-port", port.ToString(),
                     "-insecure",
                     "+map", "de_dust2", "+game_type", "0", "+game_mode", "1",
                     "+sv_lan", "1", "+rcon_password", Password,
                     // An empty server stops ticking, and everything on the tick — timers,
                     // deferred work — silently stops with it.
                     "+sv_hibernate_when_empty", "0",
                 })
        {
            start.ArgumentList.Add(argument);
        }

        // The one thing that makes a run reproducible: the plugin loads these scripts
        // and no others, so whatever an operator left in the real scripts folder cannot
        // decide whether a test passes.
        start.Environment["CS2TS_SCRIPTS"] = scriptDirectory;

        var process = Process.Start(start)
            ?? throw new InvalidOperationException("the server did not start");

        var server = new DedicatedServer(process, port);
        process.OutputDataReceived += (_, e) => server.Record(e.Data);
        process.ErrorDataReceived += (_, e) => server.Record(e.Data);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        // The plugin's own output arrives promptly even though this is a pipe rather
        // than a terminal: it is written through .NET's Console, which flushes per line.
        // The engine's C++ output is block buffered and lags, which is why every marker
        // this suite waits for is one of ours.
        await server.WaitForAsync(line => line.Contains("[CS2-TS] loaded ", StringComparison.Ordinal),
            TimeSpan.FromMinutes(2), token);

        // And then wait for the way in, separately. Scripts being loaded says nothing
        // about the RCON listener, and the two do not come up in a fixed order: the
        // first run of a suite failed here with "connection refused" against a server
        // that was plainly up and had already printed its script list.
        await server.WaitForRconAsync(TimeSpan.FromMinutes(1), token);

        return server;
    }

    /// <summary>
    /// Waits until the server accepts an RCON connection, which is not the same moment
    /// as its scripts being loaded.
    /// </summary>
    private async Task WaitForRconAsync(TimeSpan timeout, CancellationToken token)
    {
        var deadline = DateTime.UtcNow + timeout;

        while (true)
        {
            try
            {
                using var rcon = RconClient.Connect(Port, Password, TimeSpan.FromSeconds(5));
                return;
            }
            catch (SocketException) when (DateTime.UtcNow < deadline)
            {
                await Task.Delay(250, token);
            }
        }
    }

    /// <summary>Runs a console command and returns once the server has taken it.</summary>
    public void Command(string command)
    {
        using var rcon = RconClient.Connect(Port, Password, TimeSpan.FromSeconds(10));
        rcon.Execute(command);
    }

    /// <summary>
    /// Waits until some line the server has printed matches, and returns it.
    /// </summary>
    /// <remarks>
    /// Lines printed before this call count. A test that runs a command and then starts
    /// watching would otherwise lose the race whenever the server answered quickly,
    /// which is most of the time and never the same time twice.
    /// </remarks>
    public async Task<string> WaitForAsync(Func<string, bool> matches, TimeSpan timeout, CancellationToken token = default)
    {
        var deadline = DateTime.UtcNow + timeout;

        while (DateTime.UtcNow < deadline)
        {
            lock (_gate)
            {
                var found = _transcript.FirstOrDefault(matches);
                if (found is not null)
                {
                    return found;
                }
            }

            if (_process.HasExited)
            {
                throw new InvalidOperationException(
                    $"the server exited with code {_process.ExitCode} while waiting. " +
                    $"Last lines:{Environment.NewLine}{string.Join(Environment.NewLine, Transcript.TakeLast(15))}");
            }

            await Task.Delay(100, token);
        }

        throw new TimeoutException(
            $"nothing matched within {timeout}. Last lines:{Environment.NewLine}" +
            string.Join(Environment.NewLine, Transcript.TakeLast(15)));
    }

    /// <summary>Forgets everything printed so far, so a wait cannot match old output.</summary>
    public void ClearTranscript()
    {
        lock (_gate)
        {
            _transcript.Clear();
        }
    }

    private void Record(string? line)
    {
        if (line is null)
        {
            return;
        }

        // The engine colours its output, and a colour code in the middle of a line is
        // enough to make an ordinary Contains check fail for reasons nobody can see.
        var clean = Ansi.Strip(line);

        lock (_gate)
        {
            _transcript.Add(clean);
        }
    }

    /// <summary>
    /// A port nothing is listening on, asked of the operating system rather than picked.
    ///
    /// Picking a number would eventually collide with a server somebody else is using —
    /// and the collision does not look like a collision. The engine reports "Failed to
    /// open/bind server socket" and then segfaults, which reads exactly like a crash in
    /// whatever was being tested.
    /// </summary>
    private static int FreePort()
    {
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    /// <summary>
    /// Stops the server this object started, and nothing else.
    ///
    /// Deliberately by handle rather than by searching for processes that look like a
    /// CS2 server. Someone is usually running their own on this machine — a session that
    /// took an afternoon to set up — and a suite that scans and kills would end it. That
    /// has happened here once already, by hand.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        if (!_process.HasExited)
        {
            _process.Kill(entireProcessTree: true);

            try
            {
                await _process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
            }
            catch (TimeoutException)
            {
                // Nothing further to do: the handle is being dropped either way, and a
                // test run must not hang on a game that will not die.
            }
        }

        _process.Dispose();
    }
}
