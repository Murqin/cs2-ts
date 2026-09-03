namespace Cs2Ts.Runtime;

/// <summary>
/// One parsed target specifier — <c>@all</c>, <c>@ct</c>, <c>#3</c>, a name fragment —
/// and the roster filter it stands for.
///
/// A command author writing <c>!slap @ct</c> or <c>!ban someguy</c> is thinking about
/// the phrase a player types, not about iterating <c>players.all()</c> with a team
/// comparison and a case-insensitive substring match written a slightly different way in
/// every script. Doing that once, here, gives every script the same vocabulary — the one
/// players already know from other servers — and keeps the parsing out of the binding,
/// which cannot be tested without a server.
///
/// Parsing and filtering are split so the parse can be checked on its own: a bad
/// specifier is a throw at the point <see cref="Parse"/> is called, which is inside a
/// command handler, so it reaches the author as an ordinary reported error rather than a
/// command that quietly selects nobody.
/// </summary>
public sealed class TargetQuery
{
    private enum Selector
    {
        All,
        Team,
        Caller,
        NotCaller,
        Bots,
        Humans,
        Alive,
        Dead,
        UserId,
        NameContains,
    }

    // 1 spectator, 2 T, 3 CT — the same numbering player.team reads back.
    private const int TeamSpectator = 1;
    private const int TeamT = 2;
    private const int TeamCt = 3;

    /// <summary>
    /// The <c>@</c> keywords, spelled out so a bad one can list what was expected. Kept
    /// as text rather than derived from the enum because the two teams share the
    /// <see cref="Selector.Team"/> case with different numbers.
    /// </summary>
    private static readonly string[] Keywords =
        ["@all", "@ct", "@t", "@spec", "@me", "@!me", "@bots", "@humans", "@alive", "@dead"];

    private readonly Selector _selector;
    private readonly int _number;
    private readonly string _text;

    private TargetQuery(Selector selector, int number = 0, string text = "")
    {
        _selector = selector;
        _number = number;
        _text = text;
    }

    /// <summary>
    /// Reads a target specifier, or throws saying why it is not one.
    ///
    /// A leading <c>@</c> is a group keyword and an unknown one throws — the set is small
    /// and closed, so a misspelling is a mistake to surface rather than a name to search
    /// for. A leading <c>#</c> is an exact userid and a non-number after it throws.
    /// Anything else is a case-insensitive fragment of a player's name, and matching
    /// nobody is an empty result rather than an error.
    /// </summary>
    /// <exception cref="ArgumentException">The string cannot be a target.</exception>
    public static TargetQuery Parse(string spec)
    {
        ArgumentNullException.ThrowIfNull(spec);

        var trimmed = spec.Trim();
        if (trimmed.Length == 0)
        {
            throw new ArgumentException("a target cannot be empty", nameof(spec));
        }

        if (trimmed[0] == '@')
        {
            return trimmed.ToLowerInvariant() switch
            {
                "@all" => new TargetQuery(Selector.All),
                "@ct" => new TargetQuery(Selector.Team, TeamCt),
                "@t" => new TargetQuery(Selector.Team, TeamT),
                "@spec" => new TargetQuery(Selector.Team, TeamSpectator),
                "@me" => new TargetQuery(Selector.Caller),
                "@!me" => new TargetQuery(Selector.NotCaller),
                "@bots" => new TargetQuery(Selector.Bots),
                "@humans" => new TargetQuery(Selector.Humans),
                "@alive" => new TargetQuery(Selector.Alive),
                "@dead" => new TargetQuery(Selector.Dead),
                _ => throw new ArgumentException(
                    $"'{spec}' is not a target keyword; try one of {string.Join(" ", Keywords)}, " +
                    "#<userid>, or part of a player's name",
                    nameof(spec)),
            };
        }

        if (trimmed[0] == '#')
        {
            if (!int.TryParse(trimmed[1..], out var userId))
            {
                throw new ArgumentException(
                    $"'{spec}' is not a userid; # has to be followed by the number", nameof(spec));
            }

            return new TargetQuery(Selector.UserId, userId);
        }

        return new TargetQuery(Selector.NameContains, text: trimmed);
    }

    /// <summary>
    /// The players in <paramref name="roster"/> this specifier selects, in the order
    /// they were given.
    ///
    /// <paramref name="callerId"/> is the userid of whoever ran the command, or
    /// <c>null</c> from the console: <c>@me</c> is then empty and <c>@!me</c> is
    /// everyone, because a console has no player to be or to exclude.
    ///
    /// A player who has left between the roster being taken and this running is skipped
    /// rather than read — <see cref="PlayerFacade{TController,TPawn}.Team"/> and the rest
    /// throw for a departed player, and a selector is not the place to find that out.
    /// </summary>
    public PlayerFacade<TController, TPawn>[] Filter<TController, TPawn>(
        IEnumerable<PlayerFacade<TController, TPawn>> roster, long? callerId)
        where TController : class
        where TPawn : class
    {
        ArgumentNullException.ThrowIfNull(roster);

        var selected = new List<PlayerFacade<TController, TPawn>>();
        foreach (var player in roster)
        {
            if (!player.IsValid)
            {
                continue;
            }

            var keep = _selector switch
            {
                Selector.All => true,
                Selector.Team => player.Team == _number,
                Selector.Caller => callerId is { } id && player.Id == id,
                Selector.NotCaller => callerId is not { } id || player.Id != id,
                Selector.Bots => player.IsBot,
                Selector.Humans => !player.IsBot,
                Selector.Alive => player.IsAlive,
                Selector.Dead => !player.IsAlive,
                Selector.UserId => player.Id == _number,
                Selector.NameContains =>
                    player.Name.Contains(_text, StringComparison.OrdinalIgnoreCase),
                _ => false,
            };

            if (keep)
            {
                selected.Add(player);
            }
        }

        return [.. selected];
    }
}
