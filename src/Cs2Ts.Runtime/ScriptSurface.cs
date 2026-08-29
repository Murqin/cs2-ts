using Microsoft.ClearScript;

namespace Cs2Ts.Runtime;

/// <summary>
/// What every generated host type derives from: its own members, and nothing else.
///
/// It exists for one reason, and it is a reason that only shows up in a test.
/// <see cref="DefaultScriptUsageAttribute"/> governs the members a type <em>declares</em>,
/// not the ones it inherits, so a host class that opts out and then does not override
/// <c>Equals</c>, <c>GetHashCode</c> and <c>ToString</c> hands all three to script
/// anyway. Nothing dangerous comes of it — reflection is prohibited separately — but the
/// surface an author sees is meant to be exactly what is written, and three of
/// <see cref="object"/>'s members turning up among the members is how that stops being
/// true.
///
/// Declaring the overrides here settles it once, for both families that are generated
/// by the hundred: the wide entity surfaces and the event payloads. Three lines of
/// boilerplate per class is a rule that gets missed.
///
/// The behaviour is unchanged: reference equality, which is already the right answer.
/// </summary>
[DefaultScriptUsage(ScriptAccess.None)]
public abstract class ScriptSurface
{
    /// <inheritdoc />
    public override bool Equals(object? obj) => base.Equals(obj);

    /// <inheritdoc />
    public override int GetHashCode() => base.GetHashCode();

    /// <summary>
    /// The type's name. Declared to be hidden rather than to be read — what a script
    /// gets a readable string from is the facade around this, not this.
    /// </summary>
    public override string ToString() => GetType().Name;
}
