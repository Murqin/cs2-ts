using System.Text.RegularExpressions;
using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// Where a script error came from. The distinction matters because only one of these
/// is the plugin author's problem, and blaming the wrong side sends whoever reads the
/// log looking in the wrong file.
/// </summary>
public enum ScriptErrorSource
{
    /// <summary>The script threw, or rejected.</summary>
    Script,

    /// <summary>The script ran too long and was interrupted by the host.</summary>
    Interrupted,

    /// <summary>The host itself failed while dispatching. Not the plugin's fault.</summary>
    Host,
}

/// <summary>
/// One script failure, attributed to a plugin and located in the author's TypeScript.
///
/// The location is real, not approximated: ts-blank-space replaces types with spaces,
/// so the JavaScript V8 compiled has the same line and column numbers as the .ts file
/// on disk, and V8's own stack frames already point at the right place.
/// </summary>
public sealed record ScriptError(
    string PluginName,
    ScriptErrorSource Source,
    string Message,
    string? FileName,
    int Line,
    int Column,
    string? StackTrace,
    bool IsAsync)
{
    // V8 frames look like "    at inner (warmup.ts:2:11)" or, with no enclosing
    // function, "    at warmup.ts:2:11". ClearScript appends " -> <source line>" to the
    // top frame, which is why the line/column group is anchored rather than greedy.
    private static readonly Regex FrameLocation = new(
        @"^\s*at\s+(?:.*?\s+\()?(?<file>[^()\s]+?):(?<line>\d+):(?<column>\d+)\)?",
        RegexOptions.Multiline | RegexOptions.Compiled);

    /// <summary>
    /// tsc's diagnostic shape, so an editor or terminal that already knows how to turn
    /// a compiler line into a jump target works on runtime errors too.
    /// </summary>
    public override string ToString()
    {
        var where = FileName is null ? $"plugin '{PluginName}'" : $"{FileName}({Line},{Column})";
        var kind = Source switch
        {
            ScriptErrorSource.Interrupted => "interrupted",
            ScriptErrorSource.Host => "host error",
            _ => IsAsync ? "unhandled rejection" : "error",
        };

        return $"{where}: {kind} in plugin '{PluginName}': {Message}";
    }

    internal static ScriptError FromException(string pluginName, Exception exception, bool isAsync)
    {
        if (exception is ScriptInterruptedException interrupted)
        {
            return Build(pluginName, ScriptErrorSource.Interrupted, interrupted.Message, interrupted.ErrorDetails, isAsync);
        }

        if (exception is ScriptEngineException script)
        {
            return Build(pluginName, ScriptErrorSource.Script, script.Message, script.ErrorDetails, isAsync);
        }

        // A failure on this side of the boundary. It still must not escape into native
        // code, but it is reported as the host's own so nobody goes looking in the .ts.
        return Build(
            pluginName,
            ScriptErrorSource.Host,
            $"{exception.GetType().Name}: {exception.Message}",
            exception.StackTrace,
            isAsync);
    }

    /// <summary>
    /// Builds an error from a rejected promise's reason, which arrives as whatever the
    /// script rejected with rather than as an exception.
    /// </summary>
    internal static ScriptError FromRejection(string pluginName, object? reason)
    {
        var message = DescribeRejection(reason, out var stack);
        return Build(pluginName, ScriptErrorSource.Script, message, stack, isAsync: true);
    }

    private static ScriptError Build(string pluginName, ScriptErrorSource source, string message, string? details, bool isAsync)
    {
        var stack = string.IsNullOrWhiteSpace(details) ? null : details.Trim();
        var match = stack is null ? Match.Empty : FrameLocation.Match(stack);

        return new ScriptError(
            pluginName,
            source,
            message.Trim(),
            match.Success ? match.Groups["file"].Value : null,
            match.Success ? int.Parse(match.Groups["line"].Value) : 0,
            match.Success ? int.Parse(match.Groups["column"].Value) : 0,
            stack,
            isAsync);
    }

    /// <summary>
    /// Rejection reasons are usually Errors but nothing requires that; a script can
    /// reject with a string, a number, or undefined. Reading the properties off a
    /// script object is done defensively because touching a disposed or exotic object
    /// throws, and an error reporter that throws is worse than a vague message.
    /// </summary>
    private static string DescribeRejection(object? reason, out string? stack)
    {
        stack = null;

        switch (reason)
        {
            case null:
                return "rejected with undefined";

            case ScriptObject script:
                try
                {
                    stack = script.GetProperty("stack") as string;
                    if (script.GetProperty("message") is string message && message.Length > 0)
                    {
                        var name = script.GetProperty("name") as string;
                        return string.IsNullOrEmpty(name) ? message : $"{name}: {message}";
                    }
                }
                catch (Exception)
                {
                    // Fall through to the generic description below.
                }

                return "rejected with a non-Error value";

            default:
                return $"rejected with {reason}";
        }
    }
}
