using System.Runtime.InteropServices;
using Microsoft.ClearScript.V8;

namespace Cs2Ts.Spike;

/// <summary>
/// Loads ClearScript's native V8 with RTLD_DEEPBIND before ClearScript's own loader
/// gets to it.
///
/// The CS2 server already has Valve's V8 11.9 in the global lookup scope: Metamod's
/// load pulls libv8.so there, well before coreclr starts (measured with
/// LD_DEBUG=scopes). ClearScriptV8.linux-x64.so statically links V8 14.7 but exports
/// all 58k v8:: symbols at default visibility, routes 41k of its own calls through the
/// PLT, and is not built with -Bsymbolic. Without DEEPBIND those call sites resolve
/// against the global scope first and land in Valve's V8 — confirmed in the control
/// run, which aborted inside Valve's libv8_libbase.so with
/// "Wrong initialization order: from 4 to 5, expected to 1!".
///
/// DEEPBIND puts the object's own scope ahead of the global one, which fits this case
/// exactly: the library imports no v8:: symbol (0 undefined), so preferring its own
/// definitions costs nothing.
///
/// The flags only take effect if they are applied to the file ClearScript actually
/// opens. The host loads plugin assemblies from memory, so Assembly.Location is blank,
/// ClearScript's disk search finds nothing, and P/Invoke resolution answers with a copy
/// under a temp directory that the preload never touched. Claiming that resolution is
/// therefore not an optimisation — without it the preload is dead weight and the server
/// aborts.
/// </summary>
internal static class V8Bootstrap
{
    private const int RtldNow = 0x00002;
    private const int RtldDeepBind = 0x00008;
    private const string NativeName = "ClearScriptV8.linux-x64.so";

    [DllImport("libc", EntryPoint = "dlopen", CharSet = CharSet.Ansi)]
    private static extern IntPtr DlOpen(string fileName, int flags);

    [DllImport("libc", EntryPoint = "dlerror")]
    private static extern IntPtr DlError();

    /// <summary>
    /// Mirrors ClearScript's V8Proxy.GetDirPaths so the preload targets the file
    /// ClearScript will actually dlopen. Guessing the plugin directory is not enough:
    /// the host shadow-copies plugin assemblies to a temp directory, and ClearScript
    /// resolves the native library relative to its own assembly, not to the plugin.
    /// glibc keys dlopen on the file rather than the spelling of the path, so hitting
    /// the same file is what matters.
    /// </summary>
    public static IEnumerable<string> CandidatePaths(string pluginDirectory)
    {
        var location = typeof(V8ScriptEngine).Assembly.Location;
        if (!string.IsNullOrWhiteSpace(location))
        {
            var dir = Path.GetDirectoryName(location);
            if (dir is not null)
            {
                yield return Path.Combine(dir, "runtimes", "linux-x64", "native", NativeName);
                yield return Path.Combine(dir, NativeName);
            }
        }

        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        if (!string.IsNullOrWhiteSpace(baseDir))
        {
            yield return Path.Combine(baseDir, NativeName);
        }

        // The host loads plugin assemblies from memory, so Assembly.Location is blank
        // and ClearScript's own search finds nothing on disk. Whatever puts a copy of
        // the native library under a temp directory is the file that actually gets
        // dlopen'd, so it is the only preload target that matters.
        foreach (var path in TempCopies())
        {
            yield return path;
        }

        yield return Path.Combine(pluginDirectory, "runtimes", "linux-x64", "native", NativeName);
        yield return Path.Combine(pluginDirectory, NativeName);
    }

    public static IEnumerable<string> TempCopies()
    {
        string[] found;
        try
        {
            found = Directory.GetFiles(Path.GetTempPath(), NativeName, SearchOption.AllDirectories);
        }
        catch (Exception)
        {
            yield break;
        }

        foreach (var path in found)
        {
            yield return path;
        }
    }

    public static string? Locate(string pluginDirectory)
    {
        return CandidatePaths(pluginDirectory).Distinct().FirstOrDefault(File.Exists);
    }

    /// <summary>
    /// Returns the dlopen handle, or IntPtr.Zero with <paramref name="error"/> set.
    /// </summary>
    public static IntPtr LoadDeepBind(string soPath, out string? error)
    {
        error = null;
        var handle = DlOpen(soPath, RtldNow | RtldDeepBind);
        if (handle != IntPtr.Zero)
        {
            return handle;
        }

        var message = DlError();
        error = message == IntPtr.Zero ? "dlopen failed without a message" : Marshal.PtrToStringAnsi(message);
        return IntPtr.Zero;
    }

    /// <summary>
    /// Preloads with DEEPBIND and routes ClearScript's P/Invoke resolution to that
    /// handle. Both halves are required; either alone leaves the process aborting
    /// inside Valve's V8. Safe to call once per process.
    /// </summary>
    public static bool Install(string pluginDirectory, Action<string> log)
    {
        var soPath = Locate(pluginDirectory);
        if (soPath is null)
        {
            log("bootstrap FAILED: ClearScriptV8.linux-x64.so not found on any candidate path");
            return false;
        }

        var handle = LoadDeepBind(soPath, out var error);
        if (handle == IntPtr.Zero)
        {
            log($"bootstrap FAILED: dlopen {soPath}: {error}");
            return false;
        }

        NativeLibrary.SetDllImportResolver(
            typeof(V8ScriptEngine).Assembly,
            (name, _, _) => name.Contains("ClearScriptV8", StringComparison.Ordinal) ? handle : IntPtr.Zero);

        log($"bootstrap ok deepbind={soPath} handle=0x{handle.ToInt64():x}");
        return true;
    }
}
