using System.Text;

namespace Cs2Ts.Spike;

/// <summary>
/// Append-only progress log, flushed after every write.
/// A symbol collision between the two V8 builds in this process can end it with
/// SIGSEGV, which unwinds nothing and buffers nothing: the last line that reached
/// disk is the only evidence of how far the spike got.
/// </summary>
internal static class SpikeLog
{
    private static readonly object Gate = new();
    private static string _path = "/tmp/cs2ts-spike.log";

    public static void Open(string path)
    {
        lock (Gate)
        {
            _path = path;
            File.WriteAllText(_path, $"=== cs2-ts spike {DateTime.UtcNow:O} ===\n", Encoding.UTF8);
        }
    }

    public static void Write(string message)
    {
        var line = $"[{DateTime.UtcNow:HH:mm:ss.fff}] {message}";
        Console.WriteLine($"[cs2-ts] {message}");
        lock (Gate)
        {
            using var stream = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            using var writer = new StreamWriter(stream, Encoding.UTF8);
            writer.WriteLine(line);
            writer.Flush();
            stream.Flush(true);
        }
    }
}
