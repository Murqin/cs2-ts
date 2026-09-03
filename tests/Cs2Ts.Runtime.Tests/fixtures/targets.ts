// Two commands built around players.select — the target specifiers a player already
// knows from other servers: @all, @ct, @t, @spec, @me, @!me, @bots, @humans, @alive,
// @dead, #<userid>, or part of a name.

// !slap [target] — take a little health off whoever the specifier picks out. With no
// argument it falls back to @me, so a bare !slap in chat hits the sender; from the
// console @me is nobody, which is the honest answer there.
command("!slap", (player: Player | null, args: string[]): void => {
    const spec = args[0] ?? "@me";

    let hit = 0;
    for (const target of players.select(spec, player)) {
        if (target.isAlive) {
            target.health = Math.max(1, target.health - 20);
            hit += 1;
        }
    }

    const said = `slapped ${hit} player${hit === 1 ? "" : "s"} for "${spec}"`;
    if (player === null) {
        console.log(said);
    } else {
        player.sendChat(said);
    }
});

// !who [target] — name who a specifier resolves to without touching anyone. Handy for
// checking a specifier before a command that acts on it. A misspelt keyword throws
// here, and the command boundary reports it against this file rather than selecting
// nobody in silence.
command("!who", (player: Player | null, args: string[]): void => {
    const names = players.select(args[0] ?? "@all", player).map((p) => p.name);
    const line = names.length === 0 ? "nobody" : names.join(", ");

    if (player === null) {
        console.log(line);
    } else {
        player.sendChat(line);
    }
});
