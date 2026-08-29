// A CS2-TS script. Drop it in the plugin's scripts/ directory; the server strips its
// types and runs it. Editing this file reloads it.

const Team = { Spectator: 1, T: 2, CT: 3 } as const;
type Team = (typeof Team)[keyof typeof Team];

// enum would be the obvious thing to write here, and it is rejected at compile time:
// stripping types cannot produce the object an enum needs at runtime.

let roundsPlayed = 0;

on("round_start", (event: RoundStartEvent): void => {
    roundsPlayed++;
    console.log(`round ${roundsPlayed} started, ${event.timelimit}s limit, on ${server.mapName}`);

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

// player_connect_full, not player_connect: both are real events and they are not the
// same moment. The first fires while the player is still arriving; this one fires when
// they are actually in, which is when there is something to greet.
on("player_connect_full", (event: PlayerConnectFullEvent): void => {
    // Every player on an event is nullable, and that is not paperwork. The game raises
    // events with nobody attached — a round ending, damage from the world — and the
    // compiler asking here is cheaper than finding out at runtime.
    const player = event.player;
    if (player === null) {
        return;
    }

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

on("player_spawn", (event: PlayerSpawnEvent): void => {
    const player = event.player;
    if (player === null) {
        return;
    }

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

on("player_death", (event: PlayerDeathEvent): void => {
    const player = event.player;
    if (player === null || !player.isValid) {
        return;
    }

    // What the generated events are for. None of this was reachable while the event
    // signatures were written by hand: who did it, with what, and how — and the
    // attacker is null when the world did the killing, which is a real case rather
    // than a defensive check.
    const killer = event.attacker === null ? "the world" : event.attacker.name;
    const how = event.headshot ? "headshot" : event.weapon;
    console.log(`${player.name} died to ${killer} (${how}); ${players.all().length} still connected`);
});

// A command. Players type !whereami; the server console runs css_whereami, which is
// why the null case is not optional — the compiler will not let it be forgotten.
command("!whereami", (player: Player | null, args: string[]): void => {
    if (player === null) {
        console.log(`whereami: nobody ran this — args were [${args.join(", ")}]`);
        return;
    }

    if (!player.isAlive) {
        player.sendChat("you are not in the world right now");
        return;
    }

    const { x, y, z } = player.position;
    player.sendChat(`${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)} on ${server.mapName}`);
});
