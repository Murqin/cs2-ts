using System.Numerics;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using Cs2Ts.Runtime;

namespace Cs2Ts.Plugin;

/// <summary>
/// The facade's one link to CounterStrikeSharp: what a player actually is on a running
/// server.
///
/// Every write goes through <see cref="SetNetworked"/>, and that is the whole point of
/// this file. Changing a networked field on an entity is two steps — write the field,
/// then mark it changed so the engine sends it — and the second step is invisible when
/// it is missing. The server believes the new value, no client is told, and the bug
/// looks like the game ignoring the plugin. Routing every write through one helper
/// means the step cannot be left out of a member written later.
/// </summary>
public sealed class CssPlayerOperations : IPlayerOperations<CCSPlayerController, CCSPlayerPawn>
{
    /// <inheritdoc />
    public CCSPlayerPawn? FindPawn(CCSPlayerController controller)
    {
        // Looked up every time, never kept: the pawn is the half of a player that the
        // game destroys and rebuilds, and a stored one is a dangling pointer one round
        // later. The handle is valid separately from what it points at, so both are
        // checked.
        var pawn = controller.PlayerPawn;
        return pawn is { IsValid: true, Value: { IsValid: true } value } ? value : null;
    }

    /// <inheritdoc />
    public string GetName(CCSPlayerController controller) => controller.PlayerName;

    /// <inheritdoc />
    public ulong GetSteamId(CCSPlayerController controller) => controller.SteamID;

    /// <inheritdoc />
    public bool IsBot(CCSPlayerController controller) => controller.IsBot;

    /// <inheritdoc />
    public int GetTeam(CCSPlayerController controller) => (int)controller.Team;

    /// <inheritdoc />
    public int GetMoney(CCSPlayerController controller) =>
        controller.InGameMoneyServices?.Account ?? 0;

    /// <inheritdoc />
    public void SetMoney(CCSPlayerController controller, int money)
    {
        // Absent for a player who has connected but not joined a team yet. Nothing to
        // write and nothing to report: their money is set when the services appear.
        if (controller.InGameMoneyServices is not { } services)
        {
            return;
        }

        // The field marked changed is the services pointer on the controller, not
        // Account on the services object: the schema class that replicates is
        // CCSPlayerController.
        SetNetworked(controller, "CCSPlayerController", "m_pInGameMoneyServices", () => services.Account = money);
    }

    /// <inheritdoc />
    public void SendChat(CCSPlayerController controller, string message) =>
        controller.PrintToChat(message);

    /// <inheritdoc />
    public bool IsAlive(CCSPlayerPawn pawn) => pawn.LifeState == (byte)LifeState_t.LIFE_ALIVE;

    /// <inheritdoc />
    public int GetHealth(CCSPlayerPawn pawn) => pawn.Health;

    /// <inheritdoc />
    public void SetHealth(CCSPlayerPawn pawn, int health) =>
        // m_iHealth belongs to CBaseEntity, not to the pawn's own class. Naming the
        // wrong schema class here fails the same silent way as omitting the call.
        SetNetworked(pawn, "CBaseEntity", "m_iHealth", () => pawn.Health = health);

    /// <inheritdoc />
    public int GetArmor(CCSPlayerPawn pawn) => pawn.ArmorValue;

    /// <inheritdoc />
    public void SetArmor(CCSPlayerPawn pawn, int armor) =>
        SetNetworked(pawn, "CCSPlayerPawn", "m_ArmorValue", () => pawn.ArmorValue = armor);

    /// <inheritdoc />
    public ScriptVector? GetPosition(CCSPlayerPawn pawn) =>
        pawn.AbsOrigin is { } origin ? new ScriptVector(origin.X, origin.Y, origin.Z) : null;

    /// <inheritdoc />
    public void Teleport(CCSPlayerPawn pawn, float x, float y, float z) =>
        // The Vector3 overload, with nulls for what is not being changed: the other one
        // takes CounterStrikeSharp Vectors, which are views over native memory and cost
        // an allocation each. Leaving angles alone matters — a teleport that also
        // snapped the player's aim would be a different feature.
        pawn.Teleport(new Vector3(x, y, z), null, null);

    /// <summary>
    /// Writes a networked field and tells the engine it changed.
    ///
    /// The two steps are inseparable, so they are written once, here, rather than at
    /// every call site where one of them could go missing.
    /// </summary>
    private static void SetNetworked(CBaseEntity entity, string className, string fieldName, Action write)
    {
        write();
        Utilities.SetStateChanged(entity, className, fieldName);
    }
}
