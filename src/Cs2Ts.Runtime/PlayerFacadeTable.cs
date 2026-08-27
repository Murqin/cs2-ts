namespace Cs2Ts.Runtime;

/// <summary>
/// Hands out player facades and keeps them unique per userid.
///
/// One facade per identity is what makes <c>===</c> work in script: the player passed
/// to a round-start handler is the same object as the one stored during connect, so an
/// author can compare them the way they would compare anything else. Reference
/// equality is the only equality this type offers, and it is correct precisely because
/// nothing else ever constructs a facade.
///
/// It owns the handle table underneath rather than being handed one, so that there is
/// exactly one place a player identity can come from. Two tables over the same game
/// would hand out two facades for the same player, and comparing them would fail in a
/// way that is very hard to see.
/// </summary>
/// <typeparam name="TController">The persistent half of a player.</typeparam>
/// <typeparam name="TPawn">The half that exists only while the player is in the world.</typeparam>
public sealed class PlayerFacadeTable<TController, TPawn>
    where TController : class
    where TPawn : class
{
    private readonly IPlayerOperations<TController, TPawn> _operations;
    private readonly Lock _gate = new();
    private readonly Dictionary<long, PlayerFacade<TController, TPawn>> _players = [];

    /// <param name="kind">What these refer to — "player".</param>
    /// <param name="resolve">
    /// Looks a player up by userid and returns null once they are gone. It must also
    /// return null for a controller that exists but is no longer valid, since a script
    /// cannot tell the two apart and should not have to.
    /// </param>
    /// <param name="operations">What this facade is allowed to ask the game to do.</param>
    public PlayerFacadeTable(
        string kind,
        Func<long, TController?> resolve,
        IPlayerOperations<TController, TPawn> operations)
    {
        ArgumentNullException.ThrowIfNull(operations);

        Handles = new EntityHandleTable<TController>(kind, resolve);
        _operations = operations;
    }

    /// <summary>
    /// The identities underneath. Exposed for host code that wants a handle without a
    /// facade around it — the facade is for script.
    /// </summary>
    public EntityHandleTable<TController> Handles { get; }

    /// <summary>How many players have been handed out. Diagnostics only.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _players.Count;
            }
        }
    }

    /// <summary>
    /// The facade for a userid, creating it the first time and returning that same
    /// instance afterwards. Cheap enough to call on every event: after the first call
    /// it is a dictionary lookup, and it does not touch the game.
    /// </summary>
    public PlayerFacade<TController, TPawn> For(long userId)
    {
        lock (_gate)
        {
            if (_players.TryGetValue(userId, out var existing))
            {
                return existing;
            }

            var player = new PlayerFacade<TController, TPawn>(Handles.For(userId), _operations);
            _players[userId] = player;
            return player;
        }
    }

    /// <summary>
    /// Forgets every player. Called when the engines that held these facades are gone —
    /// a reload — because nothing script-side can still be comparing them.
    ///
    /// Deliberately not called on a map change or a disconnect: a facade holds no
    /// entity and costs almost nothing, and dropping one mid-session would break
    /// <c>===</c> between a player a script stored and one it is handed afterwards.
    /// </summary>
    public void Clear()
    {
        lock (_gate)
        {
            _players.Clear();
            Handles.Clear();
        }
    }
}
