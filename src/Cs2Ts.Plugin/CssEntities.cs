using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Entities;
using Cs2Ts.Runtime;

namespace Cs2Ts.Plugin;

/// <summary>
/// The world, as everything that is not a player: weapons, the bomb, hostages, doors,
/// props, and whatever a script makes itself.
///
/// This is where a handle stops being a player-shaped idea. A player is identified by a
/// userid and kept alive by the person behind it; an entity is identified by the game's
/// own entity handle, which is a slot number with a serial number packed above it. The
/// serial is why the handle is a real identity and the index alone is not — the game
/// reuses slots constantly, so a reference kept by index would silently become a
/// reference to whatever took the slot next. Every entity a script is handed is keyed by
/// the full handle, and resolving one asks the game for the entity in that slot
/// <em>with that serial</em>.
/// </summary>
public sealed class CssEntities
{
    private readonly EntityFacadeTable _table;

    public CssEntities() => _table = new EntityFacadeTable(Build);

    /// <summary>The facades handed out so far. Diagnostics only.</summary>
    public int Count => _table.Count;

    /// <summary>
    /// Forgets every facade. Called when the engines that held them are gone — a
    /// reload — because nothing script-side can still be comparing them.
    /// </summary>
    public void Clear() => _table.Clear();

    /// <summary>
    /// The entity in a slot, or null when the slot is empty.
    ///
    /// The index is what the server console means by "entity 42" and what the game's own
    /// entity list is numbered by. It is a way in, not something to keep: what is safe
    /// to keep is what this returns.
    /// </summary>
    public EntityFacade? ByIndex(int index)
    {
        if (index is < 0 or > 32766)
        {
            return null;
        }

        // Asked for by index and then keyed by handle, so that the serial number the
        // game is carrying right now becomes part of the identity of what comes back.
        return Utilities.GetEntityFromIndex<CBaseEntity>(index) is { IsValid: true } entity
            ? _table.For(entity.EntityHandle.Raw)
            : null;
    }

    /// <summary>
    /// The facade for a CounterStrikeSharp entity, or null when it is not a live one.
    /// The way in for host code that already has the entity — an event field, a schema
    /// handle — rather than an index.
    /// </summary>
    public EntityFacade? For(CEntityInstance? entity) =>
        entity is { IsValid: true } live ? _table.For(live.EntityHandle.Raw) : null;

    /// <summary>
    /// The facade for a raw entity handle, or null when it names nothing. What a schema
    /// field holding a reference to another entity actually contains.
    /// </summary>
    public EntityFacade? ForHandle(uint raw) => _table.For(raw);

    /// <summary>
    /// Every entity whose classname is exactly <paramref name="designerName"/>.
    ///
    /// Exact rather than CounterStrikeSharp's own FindAllEntitiesByDesignerName, which
    /// matches on substring: under that rule <c>find("weapon_p250")</c> is right,
    /// <c>find("weapon_knife")</c> also returns every named knife skin, and nothing in
    /// the call says which of those just happened. A search that means what it says is
    /// worth more here than one that occasionally guesses well.
    /// </summary>
    public EntityFacade[] Find(string designerName)
    {
        ArgumentException.ThrowIfNullOrEmpty(designerName);

        return Utilities.GetAllEntities()
            .Where(entity => entity.IsValid && entity.DesignerName == designerName)
            .Select(entity => _table.For(entity.EntityHandle.Raw))
            .OfType<EntityFacade>()
            .ToArray();
    }

    /// <summary>
    /// Everything in the world right now.
    ///
    /// It is a long list — a stock map is a couple of thousand entities before anyone
    /// joins — and every one of them becomes a facade the table then has to hold. It is
    /// here because there is otherwise no way to find out what classnames a map has,
    /// which is the first thing anyone writing against this needs.
    /// </summary>
    public EntityFacade[] All() =>
        Utilities.GetAllEntities()
            .Where(entity => entity.IsValid)
            .Select(entity => _table.For(entity.EntityHandle.Raw))
            .OfType<EntityFacade>()
            .ToArray();

    /// <summary>
    /// Makes an entity of a given classname. It exists but is not in the world yet:
    /// whatever is written to it before <c>spawn()</c> is what it starts life with.
    /// </summary>
    /// <exception cref="ArgumentException">The game will not make one of those.</exception>
    public EntityFacade Create(string designerName)
    {
        ArgumentException.ThrowIfNullOrEmpty(designerName);

        // A classname the game does not know comes back as an object over a null
        // pointer rather than as null or as a throw. Reporting it here is the whole
        // difference between a typo and a script that quietly does nothing.
        var entity = Utilities.CreateEntityByName<CBaseEntity>(designerName);
        if (entity is not { IsValid: true })
        {
            throw new ArgumentException(
                $"the game would not create an entity called '{designerName}'; check the classname");
        }

        return _table.For(entity.EntityHandle.Raw)
            ?? throw new ArgumentException(
                $"'{designerName}' was created and was gone again immediately");
    }

    /// <summary>
    /// Builds the facade for one handle, or answers null when the handle names nothing —
    /// an empty slot, or one holding a different entity from the one this handle means.
    ///
    /// The serial check is not written here: <see cref="EntitySystem.GetEntityByHandle(uint)"/>
    /// compares the handle it is given against the one in the slot and answers null when
    /// they differ, which is exactly the question being asked.
    /// </summary>
    private EntityFacade? Build(long handle)
    {
        var raw = unchecked((uint)handle);
        if (Resolve(raw) is not { } entity)
        {
            return null;
        }

        // Captured once, while the entity is alive, so that a dead entity still says
        // what it used to be. Both halves are fixed for the life of a handle — a slot
        // and a serial name one entity, and it does not change classname.
        var description = $"{entity.DesignerName ?? "entity"}:{entity.Index}";

        CBaseEntity Live() =>
            Resolve(raw) ?? throw new DeadEntityException("entity", raw & 0x7FFF);

        return new EntityFacade(
            "entity",
            description,
            new CssEntityAccess(Live, new EntityRaw(Live, this), this),
            () => Resolve(raw) is not null);
    }

    private static CBaseEntity? Resolve(uint raw) =>
        EntitySystem.GetEntityByHandle(raw) is { } pointer && pointer != IntPtr.Zero
            ? new CBaseEntity(pointer)
            : null;
}
