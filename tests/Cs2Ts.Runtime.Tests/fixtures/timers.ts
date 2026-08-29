// Timers, and the two things about them that are not obvious.
//
// They are checked once per game tick, so a delay is a floor rather than a promise: ask
// for 10ms on a 64 tick server and you get about 15. And they belong to this script —
// saving the file cancels every one of them, so a reload does not leave the previous
// version's interval running underneath the new one.

on("round_start", (event: RoundStartEvent): void => {
    console.log(`round started, ${event.timelimit}s limit`);

    // A one-shot reminder. Nothing to cancel: it fires once and is gone.
    setTimeout((): void => {
        for (const player of players.all()) {
            player.sendChat("thirty seconds in — good luck");
        }
    }, 30_000);
});

// An interval that has to be cleared, so it is kept where the code that clears it can
// see it. A number, not an object: ids are numbers here as they are in a browser.
let countdown: number | null = null;

on("player_connect_full", (event: PlayerConnectFullEvent): void => {
    const player = event.player;
    if (player === null) {
        return;
    }

    player.sendChat(`welcome, ${player.name}`);

    if (countdown !== null) {
        return;
    }

    let left = 5;
    countdown = setInterval((): void => {
        left -= 1;

        if (left <= 0) {
            // Clearing from inside the handler is the normal way to stop an interval.
            // It stops after this run rather than partway through it.
            clearInterval(countdown as number);
            countdown = null;
            server.command("mp_restartgame 1");
            return;
        }

        server.command(`say warmup ends in ${left}`);
    }, 1000);
});

on("player_death", (event: PlayerDeathEvent): void => {
    const player = event.player;
    if (player === null) {
        return;
    }

    // The trap worth showing: `player` is captured here and used three seconds later,
    // by which time they may have disconnected. It holds an identity rather than a
    // pointer, so this is safe to keep — but reading it without asking is not, and
    // `isValid` is the question.
    setTimeout((): void => {
        if (!player.isValid) {
            return;
        }

        player.sendChat("respawning shortly");
    }, 3_000);
});

// Timers are per script and capped, so a handler that sets one every time it runs and
// never clears one is refused rather than allowed to pile up quietly. This is the shape
// to avoid; it is here as a comment rather than as code for that reason.
//
//     on("player_spawn", (p: Player): void => {
//         setInterval(() => p.sendChat("hi"), 1000);   // one more, every spawn, forever
//     });
