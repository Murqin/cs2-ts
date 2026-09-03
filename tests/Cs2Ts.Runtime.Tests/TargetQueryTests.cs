using Cs2Ts.Runtime;

namespace Cs2Ts.Runtime.Tests;

/// <summary>
/// The specifier vocabulary a command author gets from <c>players.select</c>: what each
/// keyword picks out, and what a bad one does.
/// </summary>
public sealed class TargetQueryTests
{
    private readonly FakeWorld _world = new();
    private readonly PlayerFacadeTable<FakeController, FakePawn> _players;

    public TargetQueryTests() =>
        _players = new PlayerFacadeTable<FakeController, FakePawn>(
            "player", _world.Resolve, new FakeOperations(_world));

    private IEnumerable<PlayerFacade<FakeController, FakePawn>> Roster(params long[] userIds) =>
        userIds.Select(_players.For);

    private static long[] Ids(IEnumerable<PlayerFacade<FakeController, FakePawn>> players) =>
        players.Select(p => p.Id).ToArray();

    [Fact]
    public void AtAllIsEveryoneOnTheRoster()
    {
        _world.Add(1);
        _world.Add(2);
        _world.Add(3);

        Assert.Equal([1, 2, 3], Ids(TargetQuery.Parse("@all").Filter(Roster(1, 2, 3), callerId: null)));
    }

    [Fact]
    public void TeamKeywordsSelectByTeamNumber()
    {
        _world.Add(1).Team = 3; // CT
        _world.Add(2).Team = 2; // T
        _world.Add(3).Team = 1; // spectator

        var roster = Roster(1, 2, 3).ToArray();
        Assert.Equal([1], Ids(TargetQuery.Parse("@ct").Filter(roster, null)));
        Assert.Equal([2], Ids(TargetQuery.Parse("@t").Filter(roster, null)));
        Assert.Equal([3], Ids(TargetQuery.Parse("@spec").Filter(roster, null)));
    }

    [Fact]
    public void AtMeIsTheCallerAndAtNotMeIsEverybodyElse()
    {
        _world.Add(1);
        _world.Add(2);
        _world.Add(3);
        var roster = Roster(1, 2, 3).ToArray();

        Assert.Equal([2], Ids(TargetQuery.Parse("@me").Filter(roster, callerId: 2)));
        Assert.Equal([1, 3], Ids(TargetQuery.Parse("@!me").Filter(roster, callerId: 2)));
    }

    [Fact]
    public void FromTheConsoleAtMeIsNobodyAndAtNotMeIsEveryone()
    {
        _world.Add(1);
        _world.Add(2);
        var roster = Roster(1, 2).ToArray();

        Assert.Empty(TargetQuery.Parse("@me").Filter(roster, callerId: null));
        Assert.Equal([1, 2], Ids(TargetQuery.Parse("@!me").Filter(roster, callerId: null)));
    }

    [Fact]
    public void BotsAndHumansSplitTheRoster()
    {
        _world.Add(1, "a-person");
        _world.Add(2, "BOT Dave", steamId: 0, isBot: true);
        _world.Add(3, "another-person");

        var roster = Roster(1, 2, 3).ToArray();
        Assert.Equal([1, 3], Ids(TargetQuery.Parse("@humans").Filter(roster, null)));
        Assert.Equal([2], Ids(TargetQuery.Parse("@bots").Filter(roster, null)));
    }

    [Fact]
    public void AliveAndDeadReadThroughToThePawn()
    {
        _world.Add(1);                       // has a living pawn by default
        _world.Add(2).Pawn!.Alive = false;   // a corpse
        _world.Add(3).Pawn = null;           // no pawn at all — spectating

        var roster = Roster(1, 2, 3).ToArray();
        Assert.Equal([1], Ids(TargetQuery.Parse("@alive").Filter(roster, null)));
        Assert.Equal([2, 3], Ids(TargetQuery.Parse("@dead").Filter(roster, null)));
    }

    [Fact]
    public void AHashSelectsExactlyOneUserId()
    {
        _world.Add(3);
        _world.Add(7);

        Assert.Equal([7], Ids(TargetQuery.Parse("#7").Filter(Roster(3, 7), null)));
        Assert.Empty(TargetQuery.Parse("#99").Filter(Roster(3, 7), null));
    }

    [Fact]
    public void ANameFragmentMatchesCaseInsensitivelyAndMayReturnSeveral()
    {
        _world.Add(1, "MurqTheFirst");
        _world.Add(2, "murq_the_second");
        _world.Add(3, "someone else");

        Assert.Equal([1, 2], Ids(TargetQuery.Parse("MURQ").Filter(Roster(1, 2, 3), null)));
    }

    [Fact]
    public void AnUnknownKeywordThrowsAndSaysWhatWasExpected()
    {
        var error = Assert.Throws<ArgumentException>(() => TargetQuery.Parse("@ctt"));

        Assert.Contains("@ctt", error.Message);
        Assert.Contains("@ct", error.Message);
        Assert.Contains("@!me", error.Message);
    }

    [Fact]
    public void AHashWithoutANumberThrows()
    {
        Assert.Throws<ArgumentException>(() => TargetQuery.Parse("#"));
        Assert.Throws<ArgumentException>(() => TargetQuery.Parse("#bob"));
    }

    [Fact]
    public void AnEmptyOrBlankSpecifierThrows()
    {
        Assert.Throws<ArgumentException>(() => TargetQuery.Parse(""));
        Assert.Throws<ArgumentException>(() => TargetQuery.Parse("   "));
    }

    [Fact]
    public void SurroundingSpaceIsIgnored()
    {
        _world.Add(1);
        Assert.Equal([1], Ids(TargetQuery.Parse("  @all  ").Filter(Roster(1), null)));
    }

    [Fact]
    public void APlayerWhoLeftIsSkippedRatherThanRead()
    {
        _world.Add(1);
        _world.Add(2);
        var roster = Roster(1, 2).ToArray();

        _world.Disconnect(1);

        // @all would read player 1's team/name if it did not check validity first, and
        // that throws for someone who has left.
        Assert.Equal([2], Ids(TargetQuery.Parse("@all").Filter(roster, null)));
    }
}
