// The script side of the server suite. Every test drives one of these commands from
// RCON and reads what comes back out of the server console, so the assertions are on
// what an author's script actually observed rather than on what the host believes.
//
// Each line starts with HARNESS so a test can find it among the engine's own output.

function alivePlayer(): Player | undefined {
    return players.all().find((player) => player.isAlive);
}

command("!hping", () => {
    console.log("HARNESS pong");
});

command("!hplayers", () => {
    const everyone = players.all();
    console.log(`HARNESS players=${everyone.length} alive=${everyone.filter((p) => p.isAlive).length}`);
});

// The escape hatch, which until now had no test that was not a person typing into a
// console: write a schema field through unsafe, then read it back through the facade,
// which reaches the same field by an entirely different route.
command("!hunsafe", () => {
    const target = alivePlayer();
    if (target === undefined) {
        console.log("HARNESS unsafe nobody-alive");
        return;
    }

    const pawn = unsafe.pawn(target);
    unsafe.setInt(pawn, "CBaseEntity", "m_iHealth", 37);
    console.log(`HARNESS unsafe host=${unsafe.getInt(pawn, "CBaseEntity", "m_iHealth")} facade=${target.health}`);
});

// The other direction, and the one that matters more: a name the schema does not have
// must be refused. Unrefused it resolves to offset zero, which is the vtable pointer.
command("!hbadname", () => {
    const target = alivePlayer();
    if (target === undefined) {
        console.log("HARNESS badname nobody-alive");
        return;
    }

    try {
        // m_iHealth is declared on CBaseEntity, not on the class that inherits it.
        unsafe.getInt(unsafe.pawn(target), "CCSPlayerPawn", "m_iHealth");
        console.log("HARNESS badname not-refused");
    } catch (error) {
        console.log(`HARNESS badname refused ${(error as Error).message}`);
    }
});

// A player who has left has to stop resolving rather than hand back a stale pointer.
let held: Player | null = null;

command("!hhold", () => {
    held = players.all()[0] ?? null;
    console.log(`HARNESS hold id=${held === null ? -1 : held.id}`);
});

command("!hheld", () => {
    if (held === null) {
        console.log("HARNESS held nothing");
        return;
    }

    try {
        console.log(`HARNESS held valid=${held.isValid} name=${held.name}`);
    } catch (error) {
        console.log(`HARNESS held valid=${held.isValid} threw ${(error as Error).message}`);
    }
});

// Timers only advance on a tick, so this also proves the server is running rather than
// hibernating — a distinction that has looked like a broken feature before.
command("!htimer", () => {
    setTimeout(() => {
        console.log("HARNESS timer fired");
    }, 200);
});

console.log("HARNESS ready");
