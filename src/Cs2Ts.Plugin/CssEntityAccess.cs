using System.Numerics;
using CounterStrikeSharp.API.Core;
using Cs2Ts.Runtime;

namespace Cs2Ts.Plugin;

/// <summary>
/// What an entity is on a running server: the game side of
/// <see cref="EntityFacade"/>, for a pawn, a controller, or anything else in the world.
///
/// One instance per entity, holding the way to find it rather than the entity. Every
/// member calls <paramref name="resolve"/> again, which throws once the entity is gone —
/// so a facade a script kept across a round reports a catchable failure instead of
/// reading freed memory.
/// </summary>
/// <param name="resolve">The live entity, or a throw. Called on every access, never held.</param>
/// <param name="raw">
/// The wide surface. Built by the caller because which one it is depends on what the
/// entity is: a pawn gets every field a CCSPlayerPawn has, anything else gets the ones
/// every entity has.
/// </param>
/// <param name="entities">
/// The server's one entity table, forwarded to the surface <c>as</c> builds for a named
/// schema class.
/// </param>
public sealed class CssEntityAccess(Func<CBaseEntity> resolve, ScriptSurface raw, CssEntities entities) : IEntityAccess
{
    /// <inheritdoc />
    public ScriptSurface Raw { get; } = raw;

    /// <inheritdoc />
    public ScriptSurface As(string schemaClass) => EntitySurfaces.For(schemaClass, resolve, entities);

    /// <inheritdoc />
    /// <remarks>
    /// Narrowed from the unsigned index the game keeps. It is a slot number below
    /// 32768, so nothing is lost, and script only has doubles anyway — the cast is
    /// here so that the declaration can honestly say "number".
    /// </remarks>
    public int Index => (int)resolve().Index;

    /// <inheritdoc />
    /// <remarks>
    /// CounterStrikeSharp answers null for an entity whose identity it cannot read.
    /// Empty is the same answer in a form a script can compare without a guard.
    /// </remarks>
    public string DesignerName => resolve().DesignerName ?? "";

    /// <inheritdoc />
    public ScriptVector? Position =>
        resolve().AbsOrigin is { } origin ? new ScriptVector(origin.X, origin.Y, origin.Z) : null;

    /// <inheritdoc />
    public void Teleport(float x, float y, float z) =>
        // The Vector3 overload, with nulls for what is not being changed: the other one
        // takes CounterStrikeSharp Vectors, which are views over native memory and cost
        // an allocation each. Leaving angles alone matters — a teleport that also
        // snapped a player's aim would be a different feature.
        resolve().Teleport(new Vector3(x, y, z), null, null);

    /// <inheritdoc />
    public void Spawn() => resolve().DispatchSpawn();

    /// <inheritdoc />
    public void Remove() => resolve().Remove();

    /// <inheritdoc />
    /// <remarks>
    /// No activator and no caller: those name the entity that triggered the input and
    /// the one that relayed it, and a script firing an input directly is neither. The
    /// inputs that read them are the ones a map wires up between entities, and there is
    /// nothing honest to pass for a script.
    /// </remarks>
    public void Input(string name, string value) =>
        resolve().AcceptInput(name, null, null, value, 0);

    /// <inheritdoc />
    public object Resolve() => resolve();
}
