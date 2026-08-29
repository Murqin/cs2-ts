using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Memory;

namespace Cs2Ts.Plugin;

/// <summary>
/// Writing a schema field, both halves of it.
///
/// Changing a networked field is two steps — write it, then tell the engine it changed —
/// and the second one is invisible when it is missing: the server believes the new
/// value, no client is ever told, and the bug looks like the game ignoring the plugin.
/// Every write in this assembly goes through here so that the step cannot be left out of
/// a member written later, or generated later. The generated surfaces call nothing else.
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
        // notify, and the generated surfaces are wide enough that many of their fields
        // are server-side only.
        if (Schema.IsSchemaFieldNetworked(className, field))
        {
            Utilities.SetStateChanged(entity, className, field);
        }
    }
}
