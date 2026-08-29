using System.Reflection;

namespace Cs2Ts.DataGen;

/// <summary>One field of a game event.</summary>
/// <param name="ScriptName">What an author types, camelCase.</param>
/// <param name="ClrName">CounterStrikeSharp's property on the event class.</param>
/// <param name="CSharpType">The payload property's type.</param>
/// <param name="TypeScriptType">What the declarations say it is.</param>
/// <param name="ReadFormat">How to copy the value out; {0} is the read from the event.</param>
/// <param name="Note">A sentence for the declarations, when the field needs one.</param>
internal sealed record EventField(
    string ScriptName,
    string ClrName,
    string CSharpType,
    string TypeScriptType,
    string ReadFormat,
    string? Note);

/// <summary>One game event: what it is called, and what it carries.</summary>
internal sealed record EventSurface(
    string GameName,
    string PayloadName,
    Type Event,
    IReadOnlyList<EventField> Fields,
    IReadOnlyDictionary<string, int> Skipped);

internal static class Events
{
    /// <summary>
    /// The name CounterStrikeSharp resolves a player field to: our facade, not its
    /// controller. Nullable because it genuinely is — a kill by the world has no
    /// attacker, and a field the event did not carry reads as nothing.
    /// </summary>
    private const string Player = "PlayerRef?";

    /// <summary>
    /// Every game event CounterStrikeSharp knows, read out of its own classes.
    ///
    /// The name is not derived from the class name — it is on the class, as an
    /// <c>EventNameAttribute</c>, which matters because the two do not agree in the way
    /// a rule would predict: <c>EventPlayerConnectFull</c> is <c>player_connect_full</c>
    /// and there is a separate <c>EventPlayerConnect</c> for <c>player_connect</c>. The
    /// hand-written list conflated exactly those two.
    /// </summary>
    public static IReadOnlyList<EventSurface> Read(Assembly assembly)
    {
        var nullability = new NullabilityInfoContext();
        var surfaces = new List<EventSurface>();
        var byGameName = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var type in assembly.GetTypes().Where(IsGameEvent).OrderBy(t => t.Name, StringComparer.Ordinal))
        {
            var gameName = GameName(type);
            if (gameName is null)
            {
                continue;
            }

            if (byGameName.TryGetValue(gameName, out var owner))
            {
                throw new InvalidOperationException(
                    $"'{gameName}' would be both {owner} and {type.Name}");
            }

            byGameName[gameName] = type.Name;

            var fields = new List<EventField>();
            var skipped = new Dictionary<string, int>(StringComparer.Ordinal);

            // Declared only: EventName and Handle live on the base and are the event
            // machinery rather than the event's own contents.
            foreach (var property in type.GetProperties(
                         BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                if (Describe(property, nullability) is not { } field)
                {
                    var kind = property.PropertyType.Name;
                    skipped[kind] = skipped.GetValueOrDefault(kind) + 1;
                    continue;
                }

                fields.Add(field);
            }

            surfaces.Add(new EventSurface(
                gameName,
                PayloadName(type),
                type,
                fields.OrderBy(field => field.ScriptName, StringComparer.Ordinal).ToList(),
                skipped));
        }

        return surfaces;
    }

    private static bool IsGameEvent(Type type)
    {
        if (!type.IsClass || type.IsAbstract)
        {
            return false;
        }

        for (var current = type.BaseType; current is not null; current = current.BaseType)
        {
            if (current.Name.StartsWith("GameEvent", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static string? GameName(Type type) =>
        type.GetCustomAttributesData()
            .FirstOrDefault(data => data.AttributeType.Name == "EventNameAttribute")
            ?.ConstructorArguments[0].Value as string;

    /// <summary><c>EventPlayerHurt</c> becomes <c>PlayerHurtEvent</c>.</summary>
    private static string PayloadName(Type type) => $"{type.Name["Event".Length..]}Event";

    /// <summary>
    /// What one field of an event becomes, or null for one that is not carried.
    ///
    /// The same three kinds as the entity surfaces, plus the one an event has that an
    /// entity field does not: a player. CounterStrikeSharp has already turned the
    /// event's raw userid into a controller, and a controller is not what a script
    /// should be handed — it is alive for the length of this callback, while the thing
    /// an author will put in a timer or a Map has to outlive it. So it becomes a facade,
    /// which is an identity.
    /// </summary>
    private static EventField? Describe(PropertyInfo property, NullabilityInfoContext nullability)
    {
        var type = property.PropertyType;
        var nullable = nullability.Create(property).ReadState == NullabilityState.Nullable;
        var blank = new EventField(ScriptName(property.Name), property.Name, "", "", "{0}", null);

        if (type.Name == "CCSPlayerController")
        {
            return blank with
            {
                CSharpType = Player,
                TypeScriptType = "Player | null",
                ReadFormat = "GameEventPlayer.For({0}, players)",
                Note = property.Name == "Userid" ? "Renamed: the event calls this userid, and it is a player." : null,
            };
        }

        return Type.GetTypeCode(type) switch
        {
            TypeCode.Boolean => blank with { CSharpType = "bool", TypeScriptType = "boolean" },

            TypeCode.Int32 => blank with { CSharpType = "int", TypeScriptType = "number" },

            // Widened rather than passed through. ClearScript marshals a 64-bit integer
            // to script as a host object rather than a number, so a long that crossed
            // untouched would be something a script cannot compare or do arithmetic on.
            // Every signed 64-bit field here is a count, a limit, an entity index or a
            // tick — the values are nowhere near the 2^53 where a double stops being
            // exact. The unsigned ones are identifiers, and they go the other way.
            TypeCode.Int64 => blank with
            {
                CSharpType = "double",
                TypeScriptType = "number",
                ReadFormat = "(double){0}",
            },

            TypeCode.Single or TypeCode.Double => blank with { CSharpType = "double", TypeScriptType = "number" },

            // Steam ids, workshop file ids, content handles. Every bit of them means
            // something and a JavaScript number would round the top of it away.
            TypeCode.UInt64 => blank with
            {
                CSharpType = "string",
                TypeScriptType = "string",
                ReadFormat = "{0}.ToString(CultureInfo.InvariantCulture)",
                Note = "A 64-bit id, as a string: it does not survive a JavaScript number.",
            },

            TypeCode.String => blank with
            {
                CSharpType = nullable ? "string?" : "string",
                TypeScriptType = nullable ? "string | null" : "string",
            },

            _ => null,
        };
    }

    /// <summary>
    /// The one rename. Every other field keeps the name the event gives it, the same
    /// deal the entity surfaces make — but <c>userid</c> is a name for a number, and
    /// CounterStrikeSharp has already turned it into a player before we see it. Leaving
    /// it would mean <c>e.userid.health = 100</c>, which reads as a mistake.
    /// </summary>
    private static string ScriptName(string clrName) =>
        clrName == "Userid" ? "player" : char.ToLowerInvariant(clrName[0]) + clrName[1..];
}
