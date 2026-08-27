namespace Cs2Ts.Runtime;

/// <summary>
/// What became of a dispatch, split finely enough to tell three situations apart that
/// look identical from the outside.
///
/// The distinction exists because of one measured mistake: a command whose handler
/// threw was reported to the operator as "no script is handling this", because the
/// count only included handlers that finished. The error was in the log one line above,
/// and the message sent whoever read it looking for a registration problem instead.
/// Nothing is worse to debug than a correct system describing itself as absent.
/// </summary>
/// <param name="Completed">Handlers that ran and returned.</param>
/// <param name="Failed">Handlers that ran and threw. Already reported.</param>
/// <param name="Skipped">
/// Handlers switched off by flood protection. They exist and are not running, which is
/// its own thing to say.
/// </param>
public readonly record struct DispatchOutcome(int Completed, int Failed, int Skipped)
{
    /// <summary>
    /// Handlers that took the call at all, whether or not they finished. This is the
    /// number that answers "did anything handle this?" — a handler that threw did.
    /// </summary>
    public int Taken => Completed + Failed;

    /// <summary>Nothing ran and nothing was switched off: nobody is registered.</summary>
    public bool Unhandled => Completed == 0 && Failed == 0 && Skipped == 0;

    /// <summary>Adds two dispatches, for a host summing across its plugins.</summary>
    public static DispatchOutcome operator +(DispatchOutcome left, DispatchOutcome right) =>
        new(left.Completed + right.Completed, left.Failed + right.Failed, left.Skipped + right.Skipped);
}
