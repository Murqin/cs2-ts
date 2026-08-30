using System.Reflection;
using CounterStrikeSharp.API.Core;

namespace Cs2Ts.DataGen;

/// <summary>One field of an entity, in the form both emitters need it.</summary>
/// <param name="ScriptName">What an author types: the schema name in camelCase.</param>
/// <param name="ClrName">CounterStrikeSharp's property, which is what the read goes through.</param>
/// <param name="ClassName">The class that declares the field, for the replication call.</param>
/// <param name="FieldName">The field's own name, likewise.</param>
/// <param name="CSharpType">The generated property's type.</param>
/// <param name="TypeScriptType">What the declarations say it is.</param>
/// <param name="ReadFormat">How to turn the CounterStrikeSharp read into that type; {0} is the read.</param>
/// <param name="WriteFormat">How to turn <c>value</c> back, or null for a field this surface will not write.</param>
/// <param name="Note">A sentence for the declarations, when the field needs one.</param>
/// <param name="Shadows">
/// Whether a surface higher in the chain already carries a field under this script name.
/// CounterStrikeSharp redeclares a handful of properties on a derived class to bind them
/// to that class's own schema field, and the generated property then needs <c>new</c> so
/// the compiler knows the shadow is meant.
/// </param>
internal sealed record SchemaField(
    string ScriptName,
    string ClrName,
    string ClassName,
    string FieldName,
    string CSharpType,
    string TypeScriptType,
    string ReadFormat,
    string? WriteFormat,
    string? Note,
    bool Shadows = false);

/// <summary>An entity's own surface, plus what was left out of it.</summary>
/// <param name="Name">The generated type's name.</param>
/// <param name="Entity">The CounterStrikeSharp class it is read from.</param>
/// <param name="BaseName">
/// The generated type this one derives from, or null for the root. Every entity class in
/// CounterStrikeSharp derives from another one down to <c>CBaseEntity</c>, so the surfaces
/// form the same tree — a surface carries only the fields its class declares, and inherits
/// the rest, which is what keeps the whole set to a few thousand members instead of the
/// forty-five thousand a flattened surface per class would be.
/// </param>
internal sealed record SchemaSurface(
    string Name,
    Type Entity,
    string? BaseName,
    IReadOnlyList<SchemaField> Fields,
    IReadOnlyDictionary<string, int> Skipped)
{
    /// <summary>
    /// Whether the TypeScript interface has to be written flat rather than with
    /// <c>extends</c>. A handful of entity classes reuse a base class's friendly name for
    /// a field of a different shape — <c>m_target</c> is a string on <c>CBaseEntity</c>
    /// and <c>m_hTarget</c> a handle on <c>CInstancedSceneEntity</c>, and both camelCase
    /// to <c>target</c>. TypeScript rejects a subinterface whose member is not assignable
    /// to the base's, so those interfaces list every field instead. The C# class stays in
    /// the tree, with <c>new</c> on the shadowing member.
    /// </summary>
    public bool Flat { get; init; }

    /// <summary>
    /// Every field including inherited ones, for a <see cref="Flat"/> interface. Empty
    /// otherwise — a normal interface lists only its own and inherits the rest.
    /// </summary>
    public IReadOnlyList<SchemaField> AllFields { get; init; } = [];
}

internal static class Surfaces
{
    /// <summary>
    /// The three surfaces that keep a hand-picked name rather than the class's own. The
    /// player facade and the entity floor were written against these before the generator
    /// covered every class, and the names read better on those paths than
    /// <c>CCSPlayerPawnRaw</c> would.
    /// </summary>
    private static readonly Dictionary<string, string> Named = new(StringComparer.Ordinal)
    {
        ["CBaseEntity"] = "EntityRaw",
        ["CCSPlayerPawn"] = "PawnRaw",
        ["CCSPlayerController"] = "ControllerRaw",
    };

    /// <summary>The generated surface name for an entity class.</summary>
    public static string NameFor(Type entity) => Named.GetValueOrDefault(entity.Name, $"{entity.Name}Raw");

    /// <summary>
    /// Every entity class CounterStrikeSharp binds, as a surface that carries its own
    /// fields and names the surface it inherits the rest from.
    ///
    /// One list, built from the assembly rather than written out, because the staleness
    /// test has to generate exactly what the tool generates: a hand-kept list would agree
    /// with the tool until somebody added a class to one of them, and the test whose whole
    /// job is to notice drift would be the thing that drifted.
    ///
    /// Ordered base-before-derived so the generated file reads down the tree, and by name
    /// within a depth so the order is stable across runs.
    /// </summary>
    public static IReadOnlyList<SchemaSurface> All()
    {
        var entities = typeof(CBaseEntity).Assembly.GetTypes()
            .Where(type => type.IsClass && IsEntity(type))
            .OrderBy(Depth)
            .ThenBy(type => type.Name, StringComparer.Ordinal)
            .ToList();

        var surfaces = new List<SchemaSurface>(entities.Count);

        // The effective field under each script name a surface carries, its own and
        // everything above it, own winning. A derived surface reads this to tell when one
        // of its fields shadows an inherited one, and whether the shadow changes the type.
        var carried = new Dictionary<string, Dictionary<string, SchemaField>>(StringComparer.Ordinal);

        foreach (var entity in entities)
        {
            var baseName = entity == typeof(CBaseEntity) ? null : NameFor(entity.BaseType!);
            var inherited = baseName is null
                ? new Dictionary<string, SchemaField>(StringComparer.Ordinal)
                : carried[baseName];

            var surface = Read(entity, baseName, inherited.Keys.ToHashSet(StringComparer.Ordinal));

            // An own field that shadows an inherited one with a different TypeScript type
            // is what forces a flat interface.
            var flat = surface.Fields.Any(field =>
                inherited.TryGetValue(field.ScriptName, out var parent) &&
                parent.TypeScriptType != field.TypeScriptType);

            var merged = new Dictionary<string, SchemaField>(inherited, StringComparer.Ordinal);
            foreach (var field in surface.Fields)
            {
                merged[field.ScriptName] = field;
            }

            carried[surface.Name] = merged;

            surfaces.Add(surface with
            {
                Flat = flat,
                AllFields = flat
                    ? merged.Values.OrderBy(field => field.ScriptName, StringComparer.Ordinal).ToList()
                    : [],
            });
        }

        return surfaces;
    }

    /// <summary>
    /// Reads one class's fields out of CounterStrikeSharp's own classes.
    ///
    /// The names are not ours and are not guessed. Every schema field CounterStrikeSharp
    /// binds carries a <c>SchemaMemberAttribute</c> naming the class that declares it and
    /// the field within it — the same pair a write has to hand back to the engine, and
    /// the pair that is silently catastrophic to get wrong. Taking both from the
    /// attribute means a generated member cannot disagree with the property it reads.
    ///
    /// Declared members only, except for the root: nothing above <c>CBaseEntity</c> is a
    /// class the tree names, so <c>CEntityInstance</c>'s schema fields are folded into the
    /// root surface rather than left with nowhere to sit.
    /// </summary>
    public static SchemaSurface Read(Type entity, string? baseName, IReadOnlySet<string> inherited)
    {
        var fields = new List<SchemaField>();
        var byScriptName = new Dictionary<string, string>(StringComparer.Ordinal);
        var skipped = new Dictionary<string, int>(StringComparer.Ordinal);

        var types = baseName is null ? Chain(entity) : [entity];

        foreach (var type in types)
        {
            foreach (var property in type.GetProperties(
                         BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                if (SchemaNames(property) is not { } names)
                {
                    continue;
                }

                var scriptName = Camel(property.Name);
                if (byScriptName.TryGetValue(scriptName, out var owner))
                {
                    // Not tolerated rather than resolved: two fields under one name on one
                    // surface means an author reaches one of them and cannot say which.
                    // A name shadowed from a base is fine — C# and the schema both let the
                    // derived one win — and is handled below.
                    throw new InvalidOperationException(
                        $"{entity.Name}: '{scriptName}' would be both {owner} and {type.Name}.{property.Name}");
                }

                if (Describe(property) is not { } described)
                {
                    var kind = Bucket(property);
                    skipped[kind] = skipped.GetValueOrDefault(kind) + 1;
                    continue;
                }

                byScriptName[scriptName] = $"{type.Name}.{property.Name}";
                fields.Add(described with
                {
                    ScriptName = scriptName,
                    ClrName = property.Name,
                    ClassName = names.Class,
                    FieldName = names.Field,
                    Shadows = inherited.Contains(scriptName),
                });
            }
        }

        return new SchemaSurface(
            NameFor(entity),
            entity,
            baseName,
            fields.OrderBy(field => field.ScriptName, StringComparer.Ordinal).ToList(),
            skipped);
    }

    /// <summary>Whether a class is one of the game's entities: it descends from CBaseEntity.</summary>
    private static bool IsEntity(Type type)
    {
        for (var current = type; current is not null; current = current.BaseType)
        {
            if (current == typeof(CBaseEntity))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// How far below <c>CBaseEntity</c> a class sits, for ordering the file. The root is
    /// zero; a class whose base is <c>CBaseEntity</c> is one.
    /// </summary>
    private static int Depth(Type type)
    {
        var depth = 0;
        for (var current = type; current is not null && current != typeof(CBaseEntity); current = current.BaseType)
        {
            depth++;
        }

        return depth;
    }

    /// <summary>
    /// The entity and everything it inherits from, derived first. It stops at
    /// CounterStrikeSharp's own base classes: nothing above them declares a schema field,
    /// and walking into object would only add members that are not the game's.
    /// </summary>
    private static IEnumerable<Type> Chain(Type entity)
    {
        for (var type = entity; type is not null && type.Name is not ("NativeObject" or "Object"); type = type.BaseType)
        {
            yield return type;
        }
    }

    private static (string Class, string Field)? SchemaNames(PropertyInfo property)
    {
        var attribute = property.GetCustomAttributesData()
            .FirstOrDefault(data => data.AttributeType.Name == "SchemaMemberAttribute");

        return attribute?.ConstructorArguments.Count == 2
            ? ((string)attribute.ConstructorArguments[0].Value!, (string)attribute.ConstructorArguments[1].Value!)
            : null;
    }

    /// <summary>
    /// What a field's type means on both sides, or null for one this surface does not
    /// carry yet.
    ///
    /// Only three things arrive in script: a number, a boolean and a string. Everything
    /// wider than that either has no honest JavaScript form — a 64-bit value does not
    /// survive a double — or is a whole object of its own, and both wait for a later
    /// step rather than arriving half-right. <c>unsafe</c> is still the way to them.
    /// </summary>
    private static SchemaField? Describe(PropertyInfo property)
    {
        var declared = property.PropertyType;
        var type = declared.IsByRef ? declared.GetElementType()! : declared;

        // A ref-returning property is how CounterStrikeSharp exposes a schema field, and
        // it is assignable — `pawn.Health = 1` writes through the ref. A readonly ref is
        // not, so it becomes a field this surface only reads.
        var writable = !declared.IsByRef || !IsReadOnlyRef(property);
        var blank = new SchemaField("", "", "", "", "", "", "{0}", null, null);

        // A field holding another entity. What it stores is a handle — a slot with a
        // serial number above it — which is the identity the entity table is keyed by,
        // so it becomes the same kind of object every other entity is rather than a
        // number an author would then have to look up themselves.
        //
        // Read-only, and that is a decision rather than a limit of the machinery: what
        // the game means by writing one of these varies per field, several of them are
        // the engine's own bookkeeping, and a wrong one is not a value that looks odd —
        // it is an entity pointing at the wrong owner. It can be added per field when
        // there is a field somebody wants.
        if (type.Name.StartsWith("CHandle", StringComparison.Ordinal))
        {
            return blank with
            {
                CSharpType = "EntityFacade?",
                TypeScriptType = "Entity<EntityRaw> | null",
                ReadFormat = "_entities.ForHandle({0}.Raw)",
                WriteFormat = null,
                Note = "Another entity, or null when it points at nothing. Read-only.",
            };
        }

        if (type.IsEnum)
        {
            // As a number, not as the enum: a host enum crosses into script as an object,
            // and what an author wants here is the value they can compare and write back.
            var name = FullName(type);
            return blank with
            {
                CSharpType = "int",
                TypeScriptType = "number",
                ReadFormat = "(int){0}",
                WriteFormat = writable ? $"({name})value" : null,
                Note = $"A {type.Name}.",
            };
        }

        return Type.GetTypeCode(type) switch
        {
            TypeCode.Boolean => blank with
            {
                CSharpType = "bool",
                TypeScriptType = "boolean",
                WriteFormat = writable ? "value" : null,
            },

            // A double on this side even though the field is a float: script only has
            // doubles, and doing the narrowing here puts it where the reason for it is.
            TypeCode.Single => blank with
            {
                CSharpType = "double",
                TypeScriptType = "number",
                WriteFormat = writable ? "(float)value" : null,
            },

            TypeCode.Double => blank with
            {
                CSharpType = "double",
                TypeScriptType = "number",
                WriteFormat = writable ? "value" : null,
            },

            // The integer types keep the game's width rather than widening to something
            // friendlier. Script sees a number either way, and a value the field cannot
            // hold is refused at the boundary instead of wrapping quietly.
            TypeCode.Int32 or TypeCode.UInt32 or TypeCode.Int16 or TypeCode.UInt16
                or TypeCode.Byte or TypeCode.SByte => blank with
                {
                    CSharpType = Keyword(type),
                    TypeScriptType = "number",
                    WriteFormat = writable ? "value" : null,
                },

            // Widened rather than passed through. ClearScript marshals a 64-bit integer
            // to script as a host object rather than a number, so a long that crossed
            // untouched would be something a script cannot compare or do arithmetic on.
            // A signed 64-bit field here is a count or an index, nowhere near the 2^53
            // where a double stops being exact.
            TypeCode.Int64 => blank with
            {
                CSharpType = "double",
                TypeScriptType = "number",
                ReadFormat = "(double){0}",
                WriteFormat = writable ? "(long)value" : null,
            },

            // Unsigned means an identifier or a bitmask, where every bit means something
            // and a JavaScript number would round the top of it away. It is given as a
            // string, and there is no write because there would be no honest round trip.
            TypeCode.UInt64 => blank with
            {
                CSharpType = "string",
                TypeScriptType = "string",
                ReadFormat = "{0}.ToString(CultureInfo.InvariantCulture)",
                WriteFormat = null,
                Note = "A 64-bit id, as a string: it does not survive a JavaScript number.",
            },

            // Read-only, and every string field is. CounterStrikeSharp's two halves
            // disagree about what a string field is — the getter reads characters from
            // the field's own address, the setter writes an eight-byte pointer there — so
            // for every field where reading works, writing overwrites the first eight
            // characters and reports nothing.
            TypeCode.String => blank with
            {
                CSharpType = "string",
                TypeScriptType = "string",
                WriteFormat = null,
                Note = "Read-only, as every string field is.",
            },

            _ => null,
        };
    }

    /// <summary>What a skipped field was, for the summary the tool prints.</summary>
    private static string Bucket(PropertyInfo property)
    {
        var declared = property.PropertyType;
        var type = declared.IsByRef ? declared.GetElementType()! : declared;
        var name = type.Name;

        return name switch
        {
            _ when name.StartsWith("Span", StringComparison.Ordinal) => "array",
            _ when name.StartsWith("NetworkedVector", StringComparison.Ordinal) => "array",
            "Vector" or "QAngle" or "Color" or "CNetworkVelocityVector" or "CNetworkViewOffsetVector"
                or "CTransform" => "vector, angle or colour",
            _ => "sub-object",
        };
    }

    /// <summary>
    /// Whether a ref-returning property hands back a reference that cannot be written
    /// through. The compiler records that as a required modifier on the return, which is
    /// the only place it survives into metadata.
    /// </summary>
    private static bool IsReadOnlyRef(PropertyInfo property) =>
        property.GetMethod?.ReturnParameter
            .GetRequiredCustomModifiers()
            .Any(modifier => modifier.FullName == "System.Runtime.InteropServices.InAttribute") ?? true;

    private static string Keyword(Type type) => Type.GetTypeCode(type) switch
    {
        TypeCode.Int32 => "int",
        TypeCode.UInt32 => "uint",
        TypeCode.Int16 => "short",
        TypeCode.UInt16 => "ushort",
        TypeCode.Byte => "byte",
        TypeCode.SByte => "sbyte",
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "not an integer this emitter names"),
    };

    /// <summary>Fully qualified, so that generated code needs no using of its own.</summary>
    public static string FullName(Type type) => $"global::{type.FullName!.Replace('+', '.')}";

    private static string Camel(string name) => char.ToLowerInvariant(name[0]) + name[1..];
}
