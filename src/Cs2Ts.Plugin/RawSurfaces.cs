using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Memory;
using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Plugin;

/// <summary>
/// Writing a schema field, both halves of it.
///
/// Changing a networked field is two steps — write it, then tell the engine it changed —
/// and the second one is invisible when it is missing: the server believes the new
/// value, no client is ever told, and the bug looks like the game ignoring the plugin.
/// Every write in this assembly goes through here so that the step cannot be left out of
/// a member written later, or generated later.
/// </summary>
internal static class SchemaWrite
{
    /// <summary>
    /// Writes, then notifies. The write is a callback rather than a value so that the
    /// caller can use CounterStrikeSharp's own typed property and this can still be the
    /// only place that knows about replication.
    /// </summary>
    internal static void Replicate(CBaseEntity entity, string className, string field, Action write)
    {
        write();

        // Asked rather than assumed: a field that does not replicate has nobody to
        // notify, and the surfaces below are wide enough that some of their fields are
        // server-side only.
        if (Schema.IsSchemaFieldNetworked(className, field))
        {
            Utilities.SetStateChanged(entity, className, field);
        }
    }
}

/// <summary>
/// Every field a pawn has, as script reaches it through <c>player.pawn.raw</c>.
///
/// A hand-written slice of what a generator will emit. It is here in this shape, rather
/// than as five members somewhere convenient, because the shape is the thing being
/// settled: a class that holds a way to resolve the pawn and never the pawn, one member
/// per schema field, the field's own name in camelCase, and the write half done for the
/// author. The generator's job will be to produce two hundred more of these members
/// from CounterStrikeSharp's <c>SchemaMemberAttribute</c>; nothing about the surface
/// script sees should change when it does.
///
/// The names come from the schema, not from us — <c>armorValue</c>, <c>isScoped</c>,
/// <c>velocityModifier</c>. That is the deal this surface makes: it is wide and current
/// because nobody curated it, and it reads like the game's internals because it is them.
/// The curated names live on <c>player</c>.
/// </summary>
/// <remarks>
/// Public because ClearScript binds a host object's members against the engine's access
/// context, and a non-public type has none. Only members marked
/// <see cref="ScriptMemberAttribute"/> are reachable from script.
/// </remarks>
/// <param name="resolve">
/// The live pawn. Called on every access and never held: the pawn is the half of a
/// player the game destroys and rebuilds, so one kept across a round is a dangling
/// pointer. Throws for a player who has left and for one who is not in the world.
/// </param>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class PawnRaw(Func<CCSPlayerPawn> resolve) : RawSurface
{
    /// <summary>CBaseEntity/m_iHealth.</summary>
    [ScriptMember("health")]
    public int Health
    {
        get => resolve().Health;
        set
        {
            var pawn = resolve();
            SchemaWrite.Replicate(pawn, "CBaseEntity", "m_iHealth", () => pawn.Health = value);
        }
    }

    /// <summary>CCSPlayerPawn/m_ArmorValue.</summary>
    [ScriptMember("armorValue")]
    public int ArmorValue
    {
        get => resolve().ArmorValue;
        set
        {
            var pawn = resolve();
            SchemaWrite.Replicate(pawn, "CCSPlayerPawn", "m_ArmorValue", () => pawn.ArmorValue = value);
        }
    }

    /// <summary>CCSPlayerPawn/m_bIsScoped.</summary>
    [ScriptMember("isScoped")]
    public bool IsScoped
    {
        get => resolve().IsScoped;
        set
        {
            var pawn = resolve();
            SchemaWrite.Replicate(pawn, "CCSPlayerPawn", "m_bIsScoped", () => pawn.IsScoped = value);
        }
    }

    /// <summary>
    /// CCSPlayerPawn/m_flVelocityModifier. A double on this side: the value arrives from
    /// script as one, and the game works in floats, so the narrowing happens here rather
    /// than somewhere it would look like a bug.
    /// </summary>
    [ScriptMember("velocityModifier")]
    public double VelocityModifier
    {
        get => resolve().VelocityModifier;
        set
        {
            var pawn = resolve();
            SchemaWrite.Replicate(
                pawn, "CCSPlayerPawn", "m_flVelocityModifier", () => pawn.VelocityModifier = (float)value);
        }
    }

    /// <summary>
    /// CCSPlayerPawn/m_szLastPlaceName — the bombsite or callout the player is standing
    /// in.
    ///
    /// Read-only, and every string field on a generated surface will be. The two halves
    /// of CounterStrikeSharp disagree about what a string field is: the getter reads
    /// characters from the field's own address, the setter writes an eight-byte pointer
    /// there. For every field where reading works, writing would overwrite the first
    /// eight characters and report nothing.
    /// </summary>
    [ScriptMember("lastPlaceName")]
    public string LastPlaceName => resolve().LastPlaceName;
}

/// <summary>
/// Every field a controller has, as script reaches it through
/// <c>player.controller.raw</c>. The pawn's counterpart; see <see cref="PawnRaw"/> for
/// what this shape is for.
/// </summary>
/// <param name="resolve">The live controller. Throws once the player has left.</param>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class ControllerRaw(Func<CCSPlayerController> resolve) : RawSurface
{
    /// <summary>CCSPlayerController/m_iScore — the scoreboard number.</summary>
    [ScriptMember("score")]
    public int Score
    {
        get => resolve().Score;
        set
        {
            var controller = resolve();
            SchemaWrite.Replicate(controller, "CCSPlayerController", "m_iScore", () => controller.Score = value);
        }
    }

    /// <summary>
    /// CCSPlayerController/m_iPing. Unsigned because the schema field is, and a
    /// generated surface takes the game's type rather than a friendlier one — script
    /// sees a number either way, and a negative one is refused at the boundary instead
    /// of wrapping.
    /// </summary>
    [ScriptMember("ping")]
    public uint Ping
    {
        get => resolve().Ping;
        set
        {
            var controller = resolve();
            SchemaWrite.Replicate(controller, "CCSPlayerController", "m_iPing", () => controller.Ping = value);
        }
    }

    /// <summary>CBasePlayerController/m_iszPlayerName. Read-only, as every string field is.</summary>
    [ScriptMember("playerName")]
    public string PlayerName => resolve().PlayerName;
}
