// The same runtime, in plain JavaScript. Nothing here is stripped — a .js file has no
// types to remove — and it is loaded exactly like a .ts file next to it.
//
// Compile-time help is still available: jsconfig.json turns on checkJs, so an editor
// flags fetch and process the same way it would in TypeScript, and JSDoc carries types
// wherever they are wanted.

let rounds = 0;

on("round_start", (event) => {
    rounds++;
    console.log(`round ${rounds} started, ${event.timelimit}s limit, on ${server.mapName}`);
});

/** @param {PlayerConnectFullEvent} event */
function greet(event) {
    const player = event.player;
    if (player === null) {
        return;
    }

    player.sendChat(`welcome, ${player.name}`);

    // A player object keeps an identity, not a pointer. Holding it across a frame is
    // safe; isValid says whether they are still here.
    server.nextFrame(() => {
        if (!player.isValid) {
            return;
        }

        console.log(`${player.name} is still here, ${players.all().length} connected`);
    });
}

on("player_connect_full", greet);

// Commands work the same in JavaScript; JSDoc carries the types.
/**
 * @param {Player | null} player
 * @param {string[]} args
 */
function ping(player, args) {
    if (player === null) {
        console.log("ping: from the console");
        return;
    }

    player.sendChat(`pong (${args.length} argument${args.length === 1 ? "" : "s"})`);
}

command("!ping", ping);
