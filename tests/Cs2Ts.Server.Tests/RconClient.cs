using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text;

namespace Cs2Ts.Server.Tests;

/// <summary>
/// The Source RCON protocol, enough of it to run a command on a server this suite
/// started.
///
/// It is here because the alternative is a pseudo-terminal. The server's console reads
/// from its own stdin, and a redirected stdin is a pipe rather than a terminal, so the
/// engine never reads it — which is why earlier sessions drove the server through a pty
/// wrapper written from scratch each time. RCON is the interface the game already has
/// for this, it needs no terminal, and it is a protocol rather than a trick.
///
/// The reply body is deliberately not used for assertions. A command's output goes to
/// the server console, not back down this socket, so what comes back is usually empty;
/// the tests read the console instead.
/// </summary>
internal sealed class RconClient : IDisposable
{
    private const int Auth = 3;
    private const int Command = 2;

    private readonly TcpClient _client;
    private readonly NetworkStream _stream;
    private int _nextId = 1;

    private RconClient(TcpClient client)
    {
        _client = client;
        _stream = client.GetStream();
    }

    /// <summary>
    /// Connects and authenticates, or throws.
    /// </summary>
    /// <remarks>
    /// The address is loopback because the server is started with -ip 127.0.0.1. Left
    /// alone the engine binds this listener to the machine's LAN address instead —
    /// measured, and worth stating, because "connection refused" on localhost against a
    /// server that is plainly running is otherwise a long afternoon.
    /// </remarks>
    public static RconClient Connect(int port, string password, TimeSpan timeout)
    {
        var client = new TcpClient
        {
            SendTimeout = (int)timeout.TotalMilliseconds,
            ReceiveTimeout = (int)timeout.TotalMilliseconds,
        };

        client.Connect("127.0.0.1", port);

        var rcon = new RconClient(client);
        rcon.Send(Auth, password);

        // A failed auth answers with an id of -1 rather than an error, so the id is the
        // only thing that says whether this worked.
        var (id, _) = rcon.Receive();
        if (id == -1)
        {
            rcon.Dispose();
            throw new InvalidOperationException("the server refused the RCON password");
        }

        return rcon;
    }

    /// <summary>Runs one console command.</summary>
    public void Execute(string command)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(command);

        Send(Command, command);

        // Drained rather than ignored: the next command's reply would otherwise be read
        // as this one's, and the mismatch would show up somewhere unrelated.
        try
        {
            Receive();
        }
        catch (IOException)
        {
            // Some commands answer nothing at all and the read times out. That is not a
            // failure of the command, which has already been sent and run.
        }
    }

    private void Send(int type, string body)
    {
        var payload = Encoding.UTF8.GetBytes(body);

        // size, id, type, body, then two terminators: the body's and the empty string's.
        var packet = new byte[4 + 4 + 4 + payload.Length + 2];
        BinaryPrimitives.WriteInt32LittleEndian(packet, packet.Length - 4);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(4), _nextId++);
        BinaryPrimitives.WriteInt32LittleEndian(packet.AsSpan(8), type);
        payload.CopyTo(packet.AsSpan(12));

        _stream.Write(packet);
        _stream.Flush();
    }

    private (int Id, string Body) Receive()
    {
        var header = new byte[4];
        _stream.ReadExactly(header);

        var size = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (size is < 10 or > 8192)
        {
            throw new IOException($"the server sent a {size} byte RCON packet");
        }

        var packet = new byte[size];
        _stream.ReadExactly(packet);

        var id = BinaryPrimitives.ReadInt32LittleEndian(packet);
        var body = Encoding.UTF8.GetString(packet.AsSpan(8, size - 10));
        return (id, body);
    }

    public void Dispose()
    {
        _stream.Dispose();
        _client.Dispose();
    }
}
