using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Memory;
using Cs2Ts.Runtime;
using Microsoft.ClearScript;

namespace Cs2Ts.Plugin;

/// <summary>
/// The <c>unsafe</c> global: a way to the entity state the facade does not cover.
///
/// The facade will always be behind the game, and a script that needs a field nobody
/// has written a facade member for should have a way through rather than a dead end.
/// <c>resolve()</c> was meant to be that way through, and on a server it turned out not
/// to be: ClearScript hands script an ordinary CLR member as a real value, but
/// CounterStrikeSharp exposes networked fields as ref-returning properties, and those
/// arrive in script as an object with nothing on it — no number comes out of it in
/// either direction, and writing one throws. Health, armour, money and position were
/// all on the wrong side of that line.
///
/// The same fields read and write perfectly from C#. So the marshalling is what was
/// broken, not the access, and this class is the marshalling done on this side: script
/// passes a name and a value, the conversion happens in host code, and what crosses the
/// boundary is a number.
///
/// It is called <c>unsafe</c> because it is. Nothing here can check that the field it
/// is about to write means what the author thinks it means, and the two guards that do
/// exist — the class has to be in the schema, the field has to be in the class — are
/// there to catch the failure that has no other symptom. A wrong name in
/// CounterStrikeSharp resolves to offset zero, which on these objects is the vtable
/// pointer: writing there does not report anything, it corrupts the entity.
/// </summary>
/// <remarks>
/// Public because ClearScript binds a host object's members against the engine's access
/// context, and a non-public type has none. Only members marked
/// <see cref="ScriptMemberAttribute"/> are reachable from script.
/// </remarks>
[DefaultScriptUsage(ScriptAccess.None)]
public sealed class UnsafeApi(IPlayerOperations<CCSPlayerController, CCSPlayerPawn> operations)
{
    /// <summary>
    /// The live controller for a player: the half of them that persists across deaths
    /// and rounds, and where name, team and money live.
    ///
    /// The same object <c>player.resolve()</c> returns. It is here as well so that the
    /// pair of entities a script needs for these accessors can be reached from one
    /// place, rather than one of them coming from the facade and the other from here.
    /// </summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    [ScriptMember("controller")]
    public CCSPlayerController Controller(PlayerFacade<CCSPlayerController, CCSPlayerPawn> player)
    {
        ArgumentNullException.ThrowIfNull(player);
        return player.Resolve();
    }

    /// <summary>
    /// The live pawn for a player: their body, and where health, armour and position
    /// live.
    ///
    /// Without this the escape hatch would still be shut for everything on the pawn.
    /// The pawn is reached from the controller through a schema field, which is exactly
    /// the kind of member script cannot follow — so a script holding a controller has
    /// no way to arrive here on its own.
    /// </summary>
    /// <exception cref="DeadEntityException">The player has left.</exception>
    /// <exception cref="NoPawnException">The player is not in the world.</exception>
    [ScriptMember("pawn")]
    public CCSPlayerPawn Pawn(PlayerFacade<CCSPlayerController, CCSPlayerPawn> player)
    {
        ArgumentNullException.ThrowIfNull(player);

        // The facade's own pawn rules, not a second copy of them: a pawn that exists but
        // is not valid counts as no pawn, and only one place should decide that.
        return operations.FindPawn(player.Resolve())
            ?? throw new NoPawnException(player.Kind, player.Id);
    }

    /// <summary>Reads a 32-bit integer field.</summary>
    [ScriptMember("getInt")]
    public int GetInt(CBaseEntity entity, string className, string field) =>
        Read<int>(entity, className, field);

    /// <summary>Writes a 32-bit integer field, and tells the clients about it.</summary>
    [ScriptMember("setInt")]
    public void SetInt(CBaseEntity entity, string className, string field, int value) =>
        Write(entity, className, field, value);

    /// <summary>Reads a float field.</summary>
    [ScriptMember("getFloat")]
    public float GetFloat(CBaseEntity entity, string className, string field) =>
        Read<float>(entity, className, field);

    /// <summary>
    /// Writes a float field, and tells the clients about it. The value arrives as a
    /// JavaScript number, which is a double; the narrowing happens here rather than
    /// somewhere it would look like a bug.
    /// </summary>
    [ScriptMember("setFloat")]
    public void SetFloat(CBaseEntity entity, string className, string field, double value) =>
        Write(entity, className, field, (float)value);

    /// <summary>Reads a boolean field.</summary>
    [ScriptMember("getBool")]
    public bool GetBool(CBaseEntity entity, string className, string field) =>
        Read<bool>(entity, className, field);

    /// <summary>Writes a boolean field, and tells the clients about it.</summary>
    [ScriptMember("setBool")]
    public void SetBool(CBaseEntity entity, string className, string field, bool value) =>
        Write(entity, className, field, value);

    /// <summary>
    /// Reads a string field, as the characters stored in the field itself.
    ///
    /// There is deliberately no setString. CounterStrikeSharp's two halves disagree
    /// about what a string field is: the getter reads the characters starting at the
    /// field's own address, while the setter writes an eight-byte heap pointer there.
    /// At most one of those describes any given field, so for every field where reading
    /// works, writing overwrites the first eight characters with a pointer — silently,
    /// and with no way for this class to tell the two layouts apart beforehand. A
    /// missing capability is recoverable; a corrupted entity is not.
    /// </summary>
    [ScriptMember("getString")]
    public string GetString(CBaseEntity entity, string className, string field) =>
        Read<string>(entity, className, field);

    private static T Read<T>(CBaseEntity entity, string className, string field)
    {
        RequireField(entity, className, field);
        return Schema.GetSchemaValue<T>(entity.Handle, className, field);
    }

    private static void Write<T>(CBaseEntity entity, string className, string field, T value)
    {
        var networked = RequireField(entity, className, field);
        Schema.SetSchemaValue(entity.Handle, className, field, value);

        // The step that fails silently when it is missing: the server believes the new
        // value and no client is ever told, so the game looks like it ignored the
        // script. CounterStrikeSharp does not do it as part of the write, which is why
        // it is here — and it is asked of the schema rather than assumed, because a
        // field that does not replicate has nobody to notify.
        if (networked)
        {
            Utilities.SetStateChanged(entity, className, field);
        }
    }

    /// <summary>
    /// Refuses a name pair the schema does not know, and reports whether the field
    /// replicates.
    ///
    /// This is the whole safety story, and it exists because the failure it catches is
    /// invisible. CounterStrikeSharp resolves an unknown class or field to offset zero
    /// and carries on: a read returns whatever lives at the top of the object, and a
    /// write puts the value there — over the vtable pointer, on every entity in this
    /// API. Nothing throws, nothing is logged for a misspelled field, and the server
    /// crashes later somewhere unrelated.
    ///
    /// So offset zero is treated as "no such field". A schema class with a vtable has
    /// no field there to lose, and refusing a real field at offset zero on some
    /// vtable-less class would cost an author a capability they can live without.
    /// </summary>
    /// <returns>Whether the field is networked, and so needs a state change.</returns>
    private static bool RequireField(CBaseEntity entity, string className, string field)
    {
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentException.ThrowIfNullOrEmpty(className);
        ArgumentException.ThrowIfNullOrEmpty(field);

        if (!entity.IsValid)
        {
            throw new InvalidOperationException(
                $"that entity is gone; '{className}.{field}' was not read or written");
        }

        var size = Schema.GetClassSize(className);
        if (size <= 0)
        {
            throw new ArgumentException(
                $"there is no schema class called '{className}'; nothing was read or written");
        }

        // Negative is possible for a genuinely huge class: CounterStrikeSharp returns
        // this offset as a 16-bit signed value, so a field past 32767 bytes comes back
        // wrapped. Refusing it is the only honest answer here — the offset that arrived
        // is not where the field is.
        var offset = Schema.GetSchemaOffset(className, field);
        if (offset <= 0 || offset >= size)
        {
            throw new ArgumentException(
                $"'{className}' has no field called '{field}'; nothing was read or written. " +
                "The field has to be named on the class that declares it, not on a class that " +
                "inherits it — m_iHealth is CBaseEntity's, not CCSPlayerPawn's");
        }

        return Schema.IsSchemaFieldNetworked(className, field);
    }
}
