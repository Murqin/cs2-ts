// Centre-screen text: one line that flashes, and one that stays.
//
// player.sendCenter sends a line the game fades after a few seconds. hud.show keeps one
// there — the runtime sends it again before each fade — until hud.clear, until the
// player leaves, or until this script is reloaded, which takes its kept messages with it
// the way it does a timer.

on("player_spawn", (event: PlayerSpawnEvent): void => {
    const player = event.player;
    if (player === null || !player.isAlive) {
        return;
    }

    // Fades on its own. HTML is allowed: colour, <br>, size.
    player.sendCenter(`<font color='#8cf'>good luck, ${player.name}</font>`);
});

// A kept line, for as long as it is relevant.
command("!hud", (player: Player | null): void => {
    if (player === null) {
        return;
    }

    hud.show(player, "<font color='#f55'>BOMB DOWN</font>");
});

command("!clearhud", (player: Player | null): void => {
    if (player === null) {
        return;
    }

    hud.clear(player);
});
