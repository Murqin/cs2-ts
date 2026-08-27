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
});

on("player_connect", (player: PlayerHandle): void => {
    console.log(`player ${player.id} connected`);

    // The handle keeps an identity, not a pointer, so holding it across a delay is
    // safe: five seconds from now this player may be gone, and isValid says so
    // instead of the server crashing.
    server.nextFrame((): void => {
        if (!player.isValid) {
            return;
        }

        console.log(`player ${player.id} is still here on the next frame`);
    });
});

on("player_death", (player: PlayerHandle): void => {
    if (!player.isValid) {
        return;
    }

    console.log(`player ${player.id} died; ${players.all().length} still connected`);
});
