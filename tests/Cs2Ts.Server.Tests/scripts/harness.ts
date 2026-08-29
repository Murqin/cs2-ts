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

// The wide surface: `player.pawn` and `player.controller`, and the generated fields
// hanging off them. No fake can fail the way this can — every member there is a
// CounterStrikeSharp property reached by a schema name we typed out, so a wrong name is
// a wrong offset rather than a compile error, and a value that arrives as an object
// instead of a number is a marshalling question only a real engine answers.
//
// Each pair below is one field reached twice, by the curated member and by the generated
// one. They have to agree, or one of them is looking somewhere else.
command("!hentity", () => {
    const target = alivePlayer();
    if (target === undefined) {
        console.log("HARNESS entity nobody-alive");
        return;
    }

    const pawn = target.pawn;
    if (pawn === null) {
        console.log("HARNESS entity no-pawn");
        return;
    }

    pawn.raw.armorValue = 77;

    // A float, which is the one write that is narrowed on the way in. Read back through
    // the same field, so a narrowing that landed somewhere else shows up as a value.
    pawn.raw.velocityModifier = 0.5;

    // The tail is reported as types rather than values, because the type is the claim:
    // the escape hatch reads a schema field as an object with nothing on it, and
    // "object" here would mean this surface had inherited that failure without any other
    // symptom. The four cover every kind that crosses — boolean, number, string, and an
    // enum, which is a number in both directions only because it is cast.
    console.log(
        `HARNESS entity health=${pawn.raw.health}/${target.health} ` +
        `armor=${pawn.raw.armorValue}/${target.armor} ` +
        `name=${target.controller.raw.playerName}/${target.name} ` +
        `velocity=${pawn.raw.velocityModifier} ` +
        `scoped=${typeof pawn.raw.isScoped} enum=${typeof pawn.raw.moveType} ` +
        `place=${typeof pawn.raw.lastPlaceName} ` +
        `wide=${typeof target.controller.raw.playerDominated}`);
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

// The tick event, counted rather than logged: a line per tick would be sixty-four
// lines a second and the transcript would be useless for everything else.
let ticks = 0;

on("tick", () => {
    ticks++;
});

command("!hticks", () => {
    console.log(`HARNESS ticks=${ticks}`);
});
