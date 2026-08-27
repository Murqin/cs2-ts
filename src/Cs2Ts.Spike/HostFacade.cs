using CounterStrikeSharp.API;

namespace Cs2Ts.Spike;

/// <summary>
/// The shape a facade would expose to scripts: the script side holds a durable user id,
/// never a pointer, and every call re-resolves and validates before touching the entity.
///
/// Public on purpose. ClearScript binds members of non-public types through a slower
/// reflection path, and measuring that path would report a cost the real design would
/// never pay.
/// </summary>
public sealed class HostFacade
{
    public int Counter;

    public void Ping() => Counter++;

    public int Echo(int value) => value;

    public int Health(int userId)
    {
        var controller = Utilities.GetPlayerFromUserid(userId);
        if (controller is null || !controller.IsValid)
        {
            return -1;
        }

        var pawn = controller.PlayerPawn.Value;
        return pawn is null || !pawn.IsValid ? -1 : pawn.Health;
    }
}
