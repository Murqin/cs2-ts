using System.Reflection;

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
internal sealed record SchemaField(
    string ScriptName,
    string ClrName,
    string ClassName,
    string FieldName,
    string CSharpType,
    string TypeScriptType,
    string ReadFormat,
    string? WriteFormat,
    string? Note);

/// <summary>An entity's whole surface, plus what was left out of it.</summary>
internal sealed record SchemaSurface(
    string Name,
    Type Entity,
    IReadOnlyList<SchemaField> Fields,
    IReadOnlyDictionary<string, int> Skipped);

internal static class Surfaces
{
    /// <summary>
    /// Reads an entity's fields out of CounterStrikeSharp's own classes.
    ///
    /// The names are not ours and are not guessed. Every schema field CounterStrikeSharp
    /// binds carries a <c>SchemaMemberAttribute</c> naming the class that declares it and
    /// the field within it — the same pair a write has to hand back to the engine, and
    /// the pair that is silently catastrophic to get wrong. Taking both from the
    /// attribute means a generated member cannot disagree with the property it reads.
    /// </summary>
    public static SchemaSurface Read(string name, Type entity)
    {
        var fields = new List<SchemaField>();
        var byScriptName = new Dictionary<string, string>(StringComparer.Ordinal);
        var skipped = new Dictionary<string, int>(StringComparer.Ordinal);

        // Derived first. A property redeclared further down the chain is the one that
        // wins, which is the same rule C# itself applies to the call we generate.
        foreach (var type in Chain(entity))
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
                    // Not tolerated rather than resolved: two fields under one name means
                    // an author reaches one of them and cannot say which.
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
                });
            }
        }

        return new SchemaSurface(
            name,
            entity,
            fields.OrderBy(field => field.ScriptName, StringComparer.Ordinal).ToList(),
            skipped);
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

            // A 64-bit value does not fit in a JavaScript number: above 2^53 it rounds,
            // and the value it rounds to is a different one. It is given as a string, and
            // there is no write because there would be no honest round trip back.
            TypeCode.Int64 or TypeCode.UInt64 => blank with
            {
                CSharpType = "string",
                TypeScriptType = "string",
                ReadFormat = "{0}.ToString(CultureInfo.InvariantCulture)",
                WriteFormat = null,
                Note = "A 64-bit value, as a string: it does not survive a JavaScript number.",
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
            _ when name.StartsWith("CHandle", StringComparison.Ordinal) => "entity handle",
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
