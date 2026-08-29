// Things in the world that are not players: finding them, making one, taking it away.
//
// The reason a script wants any of this is that a gamemode is mostly about objects. A
// hide-and-seek mode needs props; a bomb mode needs the bomb; a shop needs to know what
// weapon someone is holding. None of that is reachable through `players`.

on("round_start", () => {
    // Exactly this classname, not a substring: `find` means what it says.
    const rifles = entities.find("weapon_ak47");
    console.log(`${rifles.length} rifle(s) lying around`);

    const bomb = entities.first("planted_c4");
    if (bomb !== null) {
        // `position` is null until an entity is placed in the world, so the compiler
        // asks about it here rather than letting a read of `.x` throw later.
        console.log(`the bomb is down at ${bomb.position?.x ?? "nowhere"}`);
    }
});

// A crate where the player is standing, for as long as the round is interesting.
command("!crate", (player) => {
    if (player === null || !player.isAlive) {
        console.log("crate needs someone standing somewhere");
        return;
    }

    const here = player.position;

    // Created, then written to, then spawned: whatever is set before `spawn` is what
    // the entity starts life with.
    const crate = entities.create("prop_physics_override");
    crate.raw.teamNum = player.team;
    crate.spawn();
    crate.teleport(here.x, here.y, here.z + 32);

    console.log(`${crate.designerName} ${crate.index} dropped for ${player.name}`);

    setTimeout(() => {
        // Ten seconds is long enough for the round to have ended and the entity to have
        // been cleaned up underneath us. The reference stays safe either way: it holds
        // the slot and the serial, so it reads as invalid rather than as whatever took
        // the slot next.
        if (crate.isValid) {
            crate.remove();
        }
    }, 10_000);
});
