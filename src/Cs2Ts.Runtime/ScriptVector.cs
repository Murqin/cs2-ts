using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// A point in the world, as script sees it.
///
/// A snapshot, not a window: the numbers are copied out of the game when the property
/// is read, and writing to them does nothing. That is the same rule the handle layer
/// follows for entities, applied to the one value type that would otherwise smuggle a
/// native pointer into script — CounterStrikeSharp's own Vector is a view over entity
/// memory, and a script that kept one would be reading freed memory a round later.
///
/// A script that wants to move a player says so with <c>teleport(x, y, z)</c>, which
/// is a call the host can validate, rather than by mutating a position it was handed.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class ScriptVector(float x, float y, float z)
{
    /// <summary>East-west, in game units.</summary>
    [ScriptMember("x")]
    public float X { get; } = x;

    /// <summary>North-south, in game units.</summary>
    [ScriptMember("y")]
    public float Y { get; } = y;

    /// <summary>Up-down, in game units.</summary>
    [ScriptMember("z")]
    public float Z { get; } = z;

    /// <summary>"(120.5, -430, 64)". Also what string interpolation gives a script.</summary>
    [ScriptMember("toString")]
    public override string ToString() => $"({X}, {Y}, {Z})";

    /// <summary>
    /// Declared only so that it stays off the script surface: DefaultScriptUsage
    /// governs declared members, not inherited ones, so a host type that leaves Equals
    /// and GetHashCode alone hands both to script.
    ///
    /// Value equality would be the tempting thing to write instead, and it would be
    /// wrong here: two readings of the same player's position a tick apart are two
    /// different measurements, not one value, and floating-point equality between them
    /// is a coin toss either way.
    /// </summary>
    public override bool Equals(object? obj) => base.Equals(obj);

    /// <inheritdoc cref="Equals" />
    public override int GetHashCode() => base.GetHashCode();
}
