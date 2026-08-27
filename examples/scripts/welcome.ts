// A CS2-TS script. Drop it in the plugin's scripts/ directory; the server strips its
// types and runs it. Editing this file reloads it.

const Team = { Spectator: 1, T: 2, CT: 3 } as const;
type Team = (typeof Team)[keyof typeof Team];

// enum would be the obvious thing to write here, and it is rejected at compile time:
// stripping types cannot produce the object an enum needs at runtime.

let roundsPlayed = 0;

on("round_start", (timeLimit: number): void => {
    roundsPlayed++;
    console.log(`round ${roundsPlayed} started, ${timeLimit}s limit, on ${server.mapName}`);

    // Writing health here is one statement. Through CounterStrikeSharp it is two — set
    // the field, then mark it changed — and leaving the second one out gives every
    // client a stale number while the server believes the new one. That was checked
    // with a client connected: the facade's write shows up on the HUD, the same write
    // made past the facade never arrives and reports nothing.
    for (const player of players.all()) {
        if (player.isAlive && player.team !== Team.Spectator) {
            player.health = 100;
            player.armor = 100;
        }
    }
});

on("player_connect", (player: Player): void => {
    player.sendChat(`welcome, ${player.name}`);

    // The player object keeps an identity, not a pointer, so holding it across a delay
    // is safe: five seconds from now they may be gone, and isValid says so instead of
    // the server crashing.
    server.nextFrame((): void => {
        if (!player.isValid) {
            return;
        }

        console.log(`${player.name} (${player.steamId}) is still here on the next frame`);
    });
});

on("player_spawn", (player: Player): void => {
    // isAlive is the guard for everything that lives on the pawn, and player_spawn is
    // where it earns its keep: the first spawn after a map change arrives before the
    // pawn does — measured on a live server, team 0 and no pawn at all — while every
    // later one has it. Without the guard this works all game and throws once, at the
    // very start, which is the worst way for a bug to behave.
    if (!player.isAlive) {
        return;
    }

    const { x, y, z } = player.position;
    console.log(`${player.name} spawned at ${x}, ${y}, ${z} with $${player.money}`);
});

on("player_death", (player: Player): void => {
    if (!player.isValid) {
        return;
    }

    console.log(`${player.name} died; ${players.all().length} still connected`);
});
