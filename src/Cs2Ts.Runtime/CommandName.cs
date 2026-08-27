using System.Text.RegularExpressions;

namespace Cs2Ts.Runtime;

/// <summary>
/// Turns what a script asked for into the one name the server will know it by.
///
/// A script writes what a player types — <c>command("!heal", ...)</c> — because that is
/// the thing an author is thinking about. The server knows commands by a console name,
/// and CounterStrikeSharp reaches them from chat by prefixing <c>css_</c>, so the two
/// spellings have to be reconciled somewhere. Doing it here, once, means a script can
/// register "!heal", "/heal" or "heal" and get the same command either way rather than
/// three that differ by a character nobody can see in a log.
/// </summary>
public static partial class CommandName
{
    /// <summary>
    /// The prefix CounterStrikeSharp puts on a console command so that a chat trigger
    /// can find it. Not something a script says; it is added on the way out.
    /// </summary>
    public const string ConsolePrefix = "css_";

    /// <summary>
    /// What a player may type in front of a command name. Stripped rather than
    /// rejected: the character is a server setting, and a script that hard-coded the
    /// wrong one would break on a server that configured the other.
    /// </summary>
    private const string Triggers = "!/.";

    /// <summary>
    /// Names CounterStrikeSharp already owns. A script registering one of these would
    /// end up sharing a console command with the framework's own admin tooling, which
    /// fails in a way nobody would think to look for.
    /// </summary>
    private static readonly HashSet<string> Reserved = new(StringComparer.Ordinal)
    {
        "plugins", "lang", "core_reload",
        "admins_reload", "admins_list",
        "groups_reload", "groups_list",
        "overrides_reload", "overrides_list",
    };

    [GeneratedRegex("^[a-z0-9_]{1,32}$")]
    private static partial Regex Allowed { get; }

    /// <summary>
    /// The canonical name for what a script asked for, or a throw explaining why not.
    ///
    /// The throw reaches the script as an ordinary Error at the point of registration,
    /// which is while the plugin is loading — so a bad name stops the plugin from
    /// loading rather than becoming a command that silently never fires.
    /// </summary>
    /// <exception cref="ArgumentException">The name cannot be a command.</exception>
    public static string Normalize(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var trimmed = name.Trim();
        if (trimmed.Length > 0 && Triggers.Contains(trimmed[0], StringComparison.Ordinal))
        {
            trimmed = trimmed[1..];
        }

        var normalized = trimmed.ToLowerInvariant();

        if (normalized.Length == 0)
        {
            throw new ArgumentException("a command name cannot be empty", nameof(name));
        }

        if (normalized.StartsWith(ConsolePrefix, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                $"'{name}': drop the {ConsolePrefix} prefix — it is added for you, and a command " +
                "registered with it would answer to css_css_ in the console",
                nameof(name));
        }

        if (!Allowed.IsMatch(normalized))
        {
            throw new ArgumentException(
                $"'{name}' is not usable as a command: letters, digits and underscores only, " +
                "at most 32 characters",
                nameof(name));
        }

        if (Reserved.Contains(normalized))
        {
            throw new ArgumentException(
                $"'{normalized}' is one of CounterStrikeSharp's own commands; pick another name",
                nameof(name));
        }

        return normalized;
    }

    /// <summary>The console command a normalized name is registered as.</summary>
    public static string ToConsoleCommand(string normalized) => ConsolePrefix + normalized;
}
