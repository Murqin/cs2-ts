// Ambient declarations for what a CS2-TS script can actually reach today.
//
// This is not @cs2-ts/api. That is a later, published package with the full surface;
// this file exists because the shipped tsconfig turns unknown globals into errors, and
// without it every script fails to compile on the first line. It declares exactly what
// the runtime installs and nothing it does not — a declaration for something that has
// not been written yet is worse than no declaration at all.

declare global {
    /**
     * A reference to something in the game. It holds an identity, never a pointer, so
     * it stays meaningful after the entity is gone — it just stops resolving.
     */
    interface EntityHandle<T = unknown> {
        /** The durable identity. For a player, their userid. */
        readonly id: number;

        /** What this refers to: "player". */
        readonly kind: string;

        /** Whether the entity is still there. Cheap; check it before doing work. */
        readonly isValid: boolean;

        /**
         * The live host object, or a thrown Error if the entity has left the game.
         *
         * This is the escape hatch. What comes back is the CounterStrikeSharp object
         * itself, untyped on purpose: past this point the script is responsible for its
         * own validity checking, and for whatever it does with a native object.
         *
         * It reads and it calls methods; it cannot write a networked field. Those are
         * ref-returning properties in CounterStrikeSharp and there is no way to assign
         * to one from script — measured. So writing health, armour or money goes
         * through the facade or not at all.
         */
        resolve(): T;

        toString(): string;
    }

    /**
     * A player. Holds a userid, not a pointer, so it stays usable after the player
     * leaves — every member simply starts throwing something catchable instead.
     *
     * Two guards never throw, and one of them is the right one to reach for:
     *
     * - `isValid` — are they still on the server?
     * - `isAlive` — are they in the world? False for spectators and for the dead,
     *   which is exactly the case that makes `health`, `armor` and `position` throw.
     *
     * Writing `health`, `armor` or `money` also tells the clients about it. Doing the
     * same thing through CounterStrikeSharp is two calls, and forgetting the second
     * one changes the value on the server while every player keeps seeing the old one.
     */
    interface Player extends EntityHandle {
        /**
         * Whether the player is alive and in the world. Never throws.
         *
         * Worth checking inside `player_spawn` too: the first spawn after a map change
         * arrives before the pawn does, so `health` and `position` throw there while
         * every later spawn reads fine.
         */
        readonly isAlive: boolean;

        /** The name the player is showing right now. */
        readonly name: string;

        /**
         * The player's Steam ID, as a string — a 64-bit id does not survive a
         * JavaScript number, and the one it rounds to belongs to somebody else.
         */
        readonly steamId: string;

        /** Whether this is a bot rather than a person. */
        readonly isBot: boolean;

        /** 1 spectator, 2 T, 3 CT. */
        readonly team: number;

        /** The player's money. Writing it replicates. */
        money: number;

        /** Health. Writing it replicates. Throws unless the player is in the world. */
        health: number;

        /** Armour. Writing it replicates. Throws unless the player is in the world. */
        armor: number;

        /**
         * Where the player is, copied out at the moment of the read: changing x, y or z
         * on what comes back moves nothing. Throws unless the player is in the world.
         */
        readonly position: { readonly x: number; readonly y: number; readonly z: number };

        /** Writes one line into this player's chat, and nobody else's. */
        sendChat(message: string): void;

        /**
         * Moves the player, keeping their view angles and velocity. Throws unless the
         * player is in the world.
         */
        teleport(x: number, y: number, z: number): void;
    }

    /** Handler signatures for the events the runtime dispatches. */
    interface Cs2TsEvents {
        round_start: (timeLimit: number) => void;
        round_end: (winner: number) => void;
        player_connect: (player: Player) => void;
        player_disconnect: (player: Player) => void;
        player_death: (player: Player) => void;
        player_spawn: (player: Player) => void;
    }

    /**
     * Registers a handler. A handler that throws is reported against this script's file
     * and line and does not reach the server; one that keeps throwing is taken out of
     * service.
     */
    function on<E extends keyof Cs2TsEvents>(event: E, handler: Cs2TsEvents[E]): void;

    /**
     * Registers a chat and console command.
     *
     * ```ts
     * command("!heal", (player, args) => {
     *     if (player === null) {
     *         console.log("heal needs a player");
     *         return;
     *     }
     *     player.health = 100;
     * });
     * ```
     *
     * The name is what a player types. A leading `!`, `/` or `.` is stripped — which
     * trigger character a server uses is a server setting, so hard-coding one would
     * break elsewhere — and what is left has to be letters, digits and underscores.
     * The same command also answers from the server console, as `css_<name>`.
     *
     * `player` is `null` when it came from the console or RCON rather than from
     * someone in the game, and the type says so because forgetting that case is how a
     * command works in chat and throws for the operator.
     *
     * `args` is everything after the command itself, unparsed.
     *
     * A bad name throws while the script is loading, so the script does not load. That
     * is deliberate: the alternative is a command that exists and never fires.
     */
    function command(
        name: string,
        handler: (player: Player | null, args: string[]) => void,
    ): void;

    /**
     * Runs `handler` once, after at least `delay` milliseconds. Returns an id for
     * `clearTimeout`.
     *
     * "At least" is the honest word: timers are checked once per game tick, so on a
     * 64 tick server nothing fires more finely than roughly every 15ms, and a delay of
     * 0 means the next tick rather than right now. Asking for less does no harm, it
     * just does not buy anything.
     *
     * The handler runs on the game thread, so it may touch the game directly — unlike a
     * callback coming back from asynchronous work, which has to go through
     * `server.nextFrame`.
     *
     * Anything the handler captures is kept alive until it fires, and a player captured
     * five seconds ago may well have left; `Player` holds an identity rather than a
     * pointer, so check `isValid` rather than assuming.
     *
     * Timers belong to the script that set them. Reloading or unloading it cancels
     * every one of them, which is why a reload does not leave the previous version's
     * work running underneath the new one.
     */
    function setTimeout(handler: () => void, delay?: number): number;

    /**
     * Runs `handler` every `delay` milliseconds until `clearInterval` is called.
     * Returns an id.
     *
     * There is no catch-up. If the server hitches for two seconds, a 100ms interval
     * fires once and is scheduled again from that moment — not twenty times in one tick
     * to make up the difference, which is never what was wanted and lands exactly when
     * the server can least afford it.
     *
     * A handler that keeps throwing is taken out of service like any other, and its
     * interval stops with it rather than failing forever on a schedule.
     */
    function setInterval(handler: () => void, delay?: number): number;

    /** Cancels a timer. Cancelling one that already fired, or never existed, is fine. */
    function clearTimeout(id: number): boolean;

    /** Cancels a timer. The same function as `clearTimeout`; both ids come from one counter. */
    function clearInterval(id: number): boolean;

    const server: {
        /**
         * Runs a callback on the game thread. The way back from asynchronous work —
         * and the only direction that exists.
         */
        nextFrame(callback: () => void): void;

        /** Runs a server console command. */
        command(command: string): void;

        /**
         * The map currently running. Never null in a script: nothing a script writes
         * runs before the map is up, because reading the game any earlier crashes the
         * server outright.
         */
        readonly mapName: string;

        readonly currentTime: number;
    };

    /** Bare V8 has no console; this one is a host API and writes to the server log. */
    const console: {
        log(value?: unknown): void;
        warn(value?: unknown): void;
        error(value?: unknown): void;
    };

    const players: {
        /** The player for a userid, whether or not they are connected now. */
        byUserId(userId: number): Player;

        /** Everyone currently connected. */
        all(): Player[];
    };
}

export {};
