// The same runtime, in plain JavaScript. Nothing here is stripped — a .js file has no
// types to remove — and it is loaded exactly like a .ts file next to it.
//
// Compile-time help is still available: jsconfig.json turns on checkJs, so an editor
// flags fetch and process the same way it would in TypeScript, and JSDoc carries types
// wherever they are wanted.

let rounds = 0;

on("round_start", (timeLimit) => {
    rounds++;
    console.log(`round ${rounds} started, ${timeLimit}s limit, on ${server.mapName}`);
});

/** @param {PlayerHandle} player */
function greet(player) {
    // A handle keeps an identity, not a pointer. Holding it across a frame is safe;
    // isValid says whether the player is still here.
    server.nextFrame(() => {
        if (!player.isValid) {
            return;
        }

        console.log(`player ${player.id} is still here, ${players.all().length} connected`);
    });
}

on("player_connect", greet);
