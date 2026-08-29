using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// One of the game's objects, with every field it has on it.
///
/// The curated surface — <see cref="PlayerFacade{TController,TPawn}"/> and what comes
/// after it — is the product: a small number of members that do the right thing, name
/// what they do, and cannot be written wrongly. It will always be behind the game. This
/// type is the floor underneath it, so that "the facade does not cover it yet" is a
/// reason to write a slightly uglier line rather than a reason to stop.
///
/// It is a separate object rather than more members on the player for two reasons. A
/// player has two of them and they are not interchangeable — a spectator has a
/// controller and no pawn, which is why <c>player.pawn</c> is nullable and the compiler
/// rather than the runtime is what says so. And the generated surface is wide: putting
/// two hundred members next to the seventeen curated ones would bury them, while
/// <c>pawn.raw.</c> asks for them by name.
///
/// Like everything else a script can keep, it holds no entity. <see cref="Raw"/> is
/// built once and kept, but the object it is has a way to resolve the entity rather
/// than the entity itself, so a pawn stored before a respawn reads the new body
/// afterwards instead of freed memory.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class EntityFacade
{
    private readonly Func<bool> _isValid;
    private readonly string _description;

    /// <param name="kind">What this is — "pawn", "controller".</param>
    /// <param name="description">What <c>toString</c> answers.</param>
    /// <param name="raw">The wide surface, made by the layer that knows the game.</param>
    /// <param name="isValid">Whether the entity is still there. Must not throw.</param>
    internal EntityFacade(string kind, string description, ScriptSurface raw, Func<bool> isValid)
    {
        Kind = kind;
        Raw = raw;
        _description = description;
        _isValid = isValid;
    }

    /// <summary>What this is — "pawn", "controller".</summary>
    [ScriptMember("kind")]
    public string Kind { get; }

    /// <summary>
    /// Whether the entity is still there: the player is on the server and, for a pawn,
    /// in the world. The cheap check before touching <see cref="Raw"/>, and like the
    /// player's own guards it never throws.
    /// </summary>
    [ScriptMember("isValid")]
    public bool IsValid => _isValid();

    /// <summary>
    /// Every field the entity has, by name.
    ///
    /// Typed as <see cref="ScriptSurface"/> because this assembly does not know the game:
    /// the surface is made by the plugin, which does, and the base type is only there to
    /// keep <see cref="object"/>'s members off it.
    ///
    /// <see cref="ScriptMemberFlags.ExposeRuntimeType"/> is what makes that work and is
    /// not optional — ClearScript binds a member's value against its <em>declared</em>
    /// type by default, so without it a script would get the members of
    /// <see cref="ScriptSurface"/>, which is none of them: every field would read as
    /// undefined and every write would be dropped, with nothing thrown and nothing
    /// logged.
    /// </summary>
    [ScriptMember("raw", ScriptMemberFlags.ExposeRuntimeType)]
    public ScriptSurface Raw { get; }

    /// <summary>"pawn of player:7". Also what string interpolation gives a script.</summary>
    [ScriptMember("toString")]
    public override string ToString() => _description;

    /// <summary>
    /// Declared only to keep it off the script surface, for the reason spelled out on
    /// <see cref="PlayerFacade{TController,TPawn}.Equals"/>: opting out by default
    /// governs declared members, not inherited ones.
    /// </summary>
    public override bool Equals(object? obj) => base.Equals(obj);

    /// <inheritdoc cref="Equals" />
    public override int GetHashCode() => base.GetHashCode();
}
