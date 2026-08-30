// The shipped tsconfig, the shipped declarations and the test suite's sample scripts
// have to agree. Each one is easy to change without noticing the other two, and the
// failure only shows up as an author's first script refusing to compile.
//
// The samples live in tests/Cs2Ts.Runtime.Tests/fixtures/ because that is what they
// are: the host suite runs them, and this one type-checks them against the config an
// author gets. Neither check is worth much alone — running proves it works on a
// runtime nobody type-checks, compiling proves it satisfies a compiler nobody runs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "..", "..", "..");
const tsc = join(here, "..", "node_modules", "typescript", "bin", "tsc");
const fixtures = join(repository, "tests", "Cs2Ts.Runtime.Tests", "fixtures");

let workspace;
let jsWorkspace;

before(() => {
    workspace = mkdtempSync(join(tmpdir(), "cs2ts-example-"));
    copyFileSync(join(repository, "templates", "tsconfig.json"), join(workspace, "tsconfig.json"));
    copyFileSync(join(repository, "templates", "cs2ts.d.ts"), join(workspace, "cs2ts.d.ts"));

    // The JavaScript author's workspace is a separate one: jsconfig and tsconfig
    // cannot both describe the same directory.
    jsWorkspace = mkdtempSync(join(tmpdir(), "cs2ts-example-js-"));
    copyFileSync(join(repository, "templates", "jsconfig.json"), join(jsWorkspace, "jsconfig.json"));
    copyFileSync(join(repository, "templates", "cs2ts.d.ts"), join(jsWorkspace, "cs2ts.d.ts"));
});

after(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(jsWorkspace, { recursive: true, force: true });
});

function check(source) {
    writeFileSync(join(workspace, "plugin.ts"), source);
    try {
        execFileSync(process.execPath, [tsc, "-p", workspace], { encoding: "utf8", stdio: "pipe" });
        return "";
    } catch (error) {
        return error.stdout ?? "";
    }
}

test("the sample script compiles against the shipped tsconfig", () => {
    const example = readFileSync(join(fixtures, "welcome.ts"), "utf8");
    assert.equal(check(example), "");
});

test("an unknown event name is rejected", () => {
    assert.match(check('on("no_such_event", () => {});\n'), /TS2345|TS2769/);
});

test("a handler with the wrong signature is rejected", () => {
    assert.match(check('on("round_start", (player: Player) => {});\n'), /TS2345|TS2769/);
});

test("an event hands the handler one object, with the fields the game gives it", () => {
    assert.equal(
        check('on("player_death", (e: PlayerDeathEvent): void => { const n: number = e.dmgHealth; });\n'),
        "");

    // The three kinds that cross, on one event.
    assert.equal(
        check('on("player_death", (e: PlayerDeathEvent): void => { const b: boolean = e.headshot; const w: string = e.weapon; });\n'),
        "");

    // A field the event does not have is a compile error rather than undefined at
    // three in the morning.
    assert.match(
        check('on("player_death", (e: PlayerDeathEvent): void => { e.noSuchField; });\n'),
        /TS2339/);
});

test("a player on an event may be nobody, and the compiler says so", () => {
    // The game raises events with nobody attached: a kill by the world has no attacker.
    assert.match(
        check('on("player_death", (e: PlayerDeathEvent): void => { e.attacker.sendChat("hi"); });\n'),
        /TS18047|TS2531|TS2533/);

    assert.equal(
        check('on("player_death", (e: PlayerDeathEvent): void => { e.attacker?.sendChat("hi"); });\n'),
        "");
});

test("player_connect and player_connect_full are not the same event", () => {
    // The hand-written list conflated them, and the generated one cannot: they are two
    // classes with two names, and the earlier one carries fields the later one does not.
    assert.equal(
        check('on("player_connect", (e: PlayerConnectEvent): void => { const bot: boolean = e.bot; });\n'),
        "");

    assert.match(
        check('on("player_connect_full", (e: PlayerConnectFullEvent): void => { e.bot; });\n'),
        /TS2339/);
});

test("a 64-bit id on an event is a string", () => {
    assert.equal(
        check('on("player_connect", (e: PlayerConnectEvent): void => { const x: string = e.xuid; });\n'),
        "");

    assert.match(
        check('on("player_connect", (e: PlayerConnectEvent): void => { e.xuid.toFixed(0); });\n'),
        /TS2339|TS2551/);
});

test("an event that carries nothing still type checks", () => {
    // Sixty-two of them are the fact that something happened and nothing else.
    assert.equal(check('on("round_freeze_end", (): void => {});\n'), "");
});

test("resolve() returns something the script has to narrow itself", () => {
    // The escape hatch is untyped on purpose; using it as if it were typed must fail.
    assert.match(check('on("tick", () => { const p = players.all()[0]!; p.resolve().Health; });\n'), /TS2339|TS2571|TS18046/);
});

test("isValid and id are usable without narrowing", () => {
    assert.equal(check('on("tick", () => { const p = players.all()[0]!; if (p.isValid) { p.id.toFixed(0); } });\n'), "");
});

test("the facade's writable members are writable and its readable ones are not", () => {
    assert.equal(check('on("tick", () => { const p = players.all()[0]!; p.health = 100; p.armor = 50; p.money = 16000; });\n'), "");

    // name and team describe the player; writing them would look like it worked.
    assert.match(check('on("tick", () => { players.all()[0]!.name = "x"; });\n'), /TS2540/);
    assert.match(check('on("tick", () => { players.all()[0]!.team = 2; });\n'), /TS2540/);
});

test("a position is a copy, and the compiler says so", () => {
    // The whole reason position is not CounterStrikeSharp's Vector: a script that
    // mutated one would be writing into entity memory, and this must not compile.
    assert.match(check('on("tick", () => { players.all()[0]!.position.x = 0; });\n'), /TS2540/);
    assert.equal(check('on("tick", () => { const p = players.all()[0]!; p.teleport(p.position.x, p.position.y, p.position.z + 64); });\n'), "");
});

test("steamId is a string, because a 64-bit id is not a JavaScript number", () => {
    assert.equal(check('on("tick", () => { const p = players.all()[0]!; p.sendChat(p.steamId.slice(0, 4)); });\n'), "");
    assert.match(check('on("tick", () => { players.all()[0]!.steamId.toFixed(0); });\n'), /TS2339|TS2551/);
});

test("a command handler has to deal with the console case", () => {
    // player is null when the command came from the console or RCON. The type is what
    // stops that being found by an operator instead of by the compiler.
    assert.equal(
        check('command("!heal", (p: Player | null): void => { if (p !== null) { p.health = 100; } });\n'),
        "");
    assert.match(
        check('command("!heal", (p: Player | null): void => { p.health = 100; });\n'),
        /TS18047|TS2531/);
});

test("a command handler with the wrong shape is rejected", () => {
    assert.match(check('command("!heal", (p: Player) => {});\n'), /TS2345|TS2769/);
    assert.match(check('command("!heal", (p: Player | null, args: number[]) => {});\n'), /TS2345|TS2769/);
    assert.match(check('command(42, () => {});\n'), /TS2345|TS2769/);
});

test("command arguments arrive as strings", () => {
    assert.equal(
        check('command("!give", (_p: Player | null, args: string[]): void => { console.log(args[0]?.trim()); });\n'),
        "");
    assert.match(
        check('command("!give", (_p: Player | null, args: string[]): void => { console.log(args[0].toFixed(0)); });\n'),
        /TS2339|TS2551/);
});

test("the timer sample compiles against the shipped tsconfig", () => {
    const example = readFileSync(join(fixtures, "timers.ts"), "utf8");
    assert.equal(check(example), "");
});

test("the declarations put setTimeout back, and typed", () => {
    // tsconfig.test.mjs asserts the shipped config drops setTimeout, because bare V8 has
    // no clock. These declarations are what makes it exist again, on this runtime's own
    // terms — so both halves have to be checked, or the pair can drift into a global
    // that type-checks and is not installed, or one installed and not declared.
    assert.equal(check("const id: number = setTimeout((): void => {}, 100);\nclearTimeout(id);\n"), "");
    assert.equal(check("const id: number = setInterval((): void => {}, 100);\nclearInterval(id);\n"), "");

    // The delay is optional, as it is everywhere else in JavaScript.
    assert.equal(check("setTimeout((): void => {});\n"), "");
});

test("a timer handler that takes arguments is rejected", () => {
    // setTimeout(fn, delay, ...args) is a Node and DOM convention this runtime does not
    // implement. A script written that way would compile and then silently get undefined.
    assert.match(check('setTimeout((who: string): void => {}, 100);\n'), /TS2345|TS2769/);
    assert.match(check('setTimeout((): void => {}, 100, "extra");\n'), /TS2554/);
});

test("the escape hatch takes an entity and gives back a number", () => {
    assert.equal(
        check([
            'on("tick", (): void => {',
            'const p = players.all()[0]!;',
            "    if (!p.isAlive) { return; }",
            "    const pawn = unsafe.pawn(p);",
            '    const health: number = unsafe.getInt(pawn, "CBaseEntity", "m_iHealth");',
            '    unsafe.setInt(pawn, "CBaseEntity", "m_iHealth", health + 25);',
            "});",
            "",
        ].join("\n")),
        "");
});

test("what the escape hatch returns is untyped, like resolve()", () => {
    // An entity is a native object with no declared shape. A script that treats one as
    // if it had members must not compile — the same bargain resolve() makes.
    assert.match(
        check('on("tick", () => { unsafe.pawn(players.all()[0]!).Health; });\n'),
        /TS2339|TS2571|TS18046/);
});

test("there is no setString to reach for", () => {
    // Its absence is a decision, not an oversight: CounterStrikeSharp's string setter
    // writes a pointer where its getter reads characters. If it ever appears here it
    // should be because someone meant it.
    assert.match(
        check('on("tick", () => { unsafe.setString(unsafe.pawn(players.all()[0]!), "C", "f", "x"); });\n'),
        /TS2339|TS2551/);
});

test("the escape hatch's value types are checked", () => {
    assert.match(
        check('on("tick", () => { unsafe.setBool(unsafe.pawn(players.all()[0]!), "C", "f", 1); });\n'),
        /TS2345|TS2769/);
    assert.match(
        check('on("tick", () => { unsafe.setInt(unsafe.pawn(players.all()[0]!), "C", "f"); });\n'),
        /TS2554/);
    assert.match(
        check('on("tick", () => { const n: number = unsafe.getString(unsafe.pawn(players.all()[0]!), "C", "f"); });\n'),
        /TS2322/);
});

test("a player's pawn may not be there, and the compiler says so", () => {
    // The whole reason pawn is a separate thing: a spectator has none. Reaching through
    // it without saying what happens then must not compile.
    assert.match(
        check('on("tick", (): void => { players.all()[0]!.pawn.raw.isScoped; });\n'),
        /TS18047|TS2531|TS2533/);

    assert.equal(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p !== null) { p.raw.isScoped; } });\n'),
        "");

    assert.equal(
        check('on("tick", (): void => { players.all()[0]!.pawn?.raw.isScoped; });\n'),
        "");
});

test("the controller is always there while the player is", () => {
    // No null: a player who has left throws on every member, and the controller is not
    // an exception to that. Nullability here would mean "spectating", which is wrong.
    assert.equal(
        check('on("tick", (): void => { const n: number = players.all()[0]!.controller.raw.score; });\n'),
        "");
});

test("a raw field is writable and typed", () => {
    assert.equal(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { p.raw.velocityModifier = 0.4; } });\n'),
        "");

    assert.match(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { p.raw.isScoped = "yes"; } });\n'),
        /TS2322/);

    // Reading a field nobody generated is a compile error, not a runtime surprise.
    assert.match(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { p.raw.noSuchField; } });\n'),
        /TS2339/);
});

test("the entity sample compiles against the shipped tsconfig", () => {
    const example = readFileSync(join(fixtures, "entities.ts"), "utf8");
    assert.equal(check(example), "");
});

test("the hud sample compiles against the shipped tsconfig", () => {
    const example = readFileSync(join(fixtures, "hud.ts"), "utf8");
    assert.equal(check(example), "");
});

test("sendCenter takes a string, like sendChat", () => {
    assert.equal(check('on("tick", () => { players.all()[0]!.sendCenter("<b>go</b>"); });\n'), "");

    // A number where a string belongs is the shape of bug the declarations refuse.
    assert.match(check('on("tick", () => { players.all()[0]!.sendCenter(42); });\n'), /TS2345|TS2769/);

    // It needs its one argument, as sendChat does.
    assert.match(check('on("tick", () => { players.all()[0]!.sendCenter(); });\n'), /TS2554/);
});

test("hud.show and hud.clear take a player, and show takes text with it", () => {
    assert.equal(
        check('command("!x", (p: Player | null) => { if (p) { hud.show(p, "<b>x</b>"); hud.clear(p); } });\n'),
        "");

    // show without text, and clear with text it does not take.
    assert.match(check('command("!x", (p: Player | null) => { if (p) { hud.show(p); } });\n'), /TS2554/);
    assert.match(check('command("!x", (p: Player | null) => { if (p) { hud.clear(p, "x"); } });\n'), /TS2554/);

    // A player who might be null is the case a script has to deal with first.
    assert.match(check('command("!x", (p: Player | null) => { hud.show(p, "x"); });\n'), /TS2345|TS2769/);
});

test("a slot may be empty, and the compiler says so", () => {
    // byIndex and first are lookups that can fail. Reaching through one without saying
    // what happens then is the mistake the null exists to catch.
    assert.match(check('on("tick", (): void => { entities.byIndex(42).remove(); });\n'), /TS18047|TS2531|TS2533/);
    assert.match(check('on("tick", (): void => { entities.first("weapon_ak47").remove(); });\n'), /TS18047|TS2531|TS2533/);

    assert.equal(check('on("tick", (): void => { entities.byIndex(42)?.remove(); });\n'), "");
});

test("create hands back an entity rather than something that may be nothing", () => {
    // The difference between making and finding: a lookup can miss, a creation either
    // works or throws. A null here would cost every script a check that cannot fail.
    assert.equal(
        check('command("!crate", (): void => { const c = entities.create("prop_physics"); c.spawn(); });\n'),
        "");
});

test("an entity's position may be nothing until it is spawned", () => {
    // A created entity has no place in the world yet, and that is the case a script
    // making entities meets first.
    assert.match(
        check('command("!c", (): void => { entities.create("prop_physics").position.x; });\n'),
        /TS18047|TS2531|TS2533/);

    assert.equal(
        check('command("!c", (): void => { const p = entities.create("prop_physics").position; if (p) { p.x.toFixed(0); } });\n'),
        "");
});

test("an entity's wide surface is the fields every entity has", () => {
    assert.equal(
        check('on("tick", (): void => { const e = entities.byIndex(1); if (e) { e.raw.teamNum = 2; } });\n'),
        "");

    // A pawn's own fields are not on it. This is the honest edge of one surface for
    // every entity, and it is a compile error rather than undefined at runtime.
    assert.match(
        check('on("tick", (): void => { const e = entities.byIndex(1); if (e) { e.raw.isScoped; } });\n'),
        /TS2339/);
});

test("index and designerName are readable and not writable", () => {
    assert.equal(
        check('on("tick", (): void => { const e = entities.byIndex(1); if (e) { console.log(`${e.designerName} ${e.index}`); } });\n'),
        "");

    // Both describe the entity. Writing either would look like it worked.
    assert.match(check('on("tick", (): void => { entities.byIndex(1)!.index = 2; });\n'), /TS2540/);
    assert.match(check('on("tick", (): void => { entities.byIndex(1)!.designerName = "x"; });\n'), /TS2540/);
});

test("an input's value is optional, because most inputs take none", () => {
    assert.equal(check('on("tick", (): void => { entities.byIndex(1)?.input("Kill"); });\n'), "");
    assert.equal(check('on("tick", (): void => { entities.byIndex(1)?.input("AddOutput", "targetname x"); });\n'), "");
    assert.match(check('on("tick", (): void => { entities.byIndex(1)?.input("Kill", 1); });\n'), /TS2345|TS2769/);
});

test("a player's two entities have the entity verbs too", () => {
    // One concept, not two. A pawn is an entity, so whatever is true of entities is
    // true of it — including that it has an index and can be asked what it is.
    assert.equal(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { console.log(`${p.designerName} ${p.index}`); } });\n'),
        "");
});

test("a field holding another entity arrives as one, and may be nothing", () => {
    // What the game stores there is a handle, which is the identity these objects are
    // keyed by — so it can arrive as the entity rather than as an index to look up.
    assert.equal(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { p.raw.groundEntity?.designerName; } });\n'),
        "");

    // It points at nothing often enough that the compiler has to ask: a player in the
    // air is standing on no entity at all.
    assert.match(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { p.raw.groundEntity.designerName; } });\n'),
        /TS18047|TS2531|TS2533/);

    // And what comes back is a whole entity, not a number.
    assert.match(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { p.raw.groundEntity?.toFixed(0); } });\n'),
        /TS2339|TS2551/);
});

test("an entity-valued field is read-only", () => {
    // What writing one means varies per field and several are the engine's own
    // bookkeeping, so none of them is writable until there is a field somebody wants.
    assert.match(
        check('on("tick", (): void => { const p = players.all()[0]!.pawn; if (p) { p.raw.groundEntity = null; } });\n'),
        /TS2540/);
});

test("the controller knows its pawn without going through the player", () => {
    // One of the eleven fields the generator used to leave out, and the one that shows
    // what carrying them buys.
    assert.equal(
        check('on("tick", (): void => { players.all()[0]!.controller.raw.playerPawn?.raw.health; });\n'),
        "");
});

/**
 * Compiles a whole folder of files in a workspace of its own.
 *
 * Its own, because check() leaves its plugin.ts behind and tsc compiles the whole
 * directory: a folder plugin dropped into that workspace would be recompiled by every
 * test after it.
 */
function checkFiles(files) {
    const where = mkdtempSync(join(tmpdir(), "cs2ts-folder-"));
    try {
        copyFileSync(join(repository, "templates", "tsconfig.json"), join(where, "tsconfig.json"));
        copyFileSync(join(repository, "templates", "cs2ts.d.ts"), join(where, "cs2ts.d.ts"));

        for (const [name, contents] of Object.entries(files)) {
            const path = join(where, name);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, contents);
        }

        try {
            execFileSync(process.execPath, [tsc, "-p", where], { encoding: "utf8", stdio: "pipe" });
            return "";
        } catch (error) {
            return error.stdout ?? "";
        }
    } finally {
        rmSync(where, { recursive: true, force: true });
    }
}

test("the folder plugin sample compiles against the shipped tsconfig", () => {
    // The same two files the host suite runs. Neither check is worth much alone:
    // running proves it works on a runtime nobody type-checks, compiling proves it
    // satisfies a compiler nobody runs.
    assert.equal(
        checkFiles({
            "jetpack/index.ts": readFileSync(join(fixtures, "jetpack", "index.ts"), "utf8"),
            "jetpack/physics.ts": readFileSync(join(fixtures, "jetpack", "physics.ts"), "utf8"),
        }),
        "");
});

test("two plugins may use the same top-level name", () => {
    // Without moduleDetection: force, a file with no imports is a script to TypeScript,
    // its top-level declarations are globals, and these two refuse to compile with
    // TS2451 — while running in separate engines where they could never collide. The
    // runtime runs every plugin as a module; the compiler has to agree.
    assert.equal(
        checkFiles({
            "jetpack.ts": 'const cooldown = 5;\non("tick", (): void => { console.log(`${cooldown}`); });\n',
            "surf.ts": 'const cooldown = 3;\non("tick", (): void => { console.log(`${cooldown}`); });\n',
        }),
        "");
});

test("a module's exports are typed across the import", () => {
    assert.match(
        checkFiles({
            "jetpack/physics.ts": "export const BOOST = 350;\n",
            "jetpack/index.ts": 'import { BOOST } from "./physics.ts";\nconst s: string = BOOST;\n',
        }),
        /TS2322/);
});

test("a tick handler takes nothing and returns nothing", () => {
    assert.equal(check('on("tick", (): void => {});\n'), "");

    // The tick carries no argument. Declaring one would compile and then silently get
    // undefined, which is the shape of bug the declarations exist to refuse.
    assert.match(check('on("tick", (delta: number): void => {});\n'), /TS2345|TS2769/);
});

test("a timer delay has to be a number", () => {
    assert.match(check('setTimeout((): void => {}, "100");\n'), /TS2345|TS2769/);
});

// ---- the JavaScript half ----

/** Returns the tsc diagnostics for a single .js file using the shipped jsconfig. */
function checkJs(source) {
    writeFileSync(join(jsWorkspace, "plugin.js"), source);
    try {
        // tsc -p on a directory looks for tsconfig.json only, so the file is named.
        execFileSync(process.execPath, [tsc, "-p", join(jsWorkspace, "jsconfig.json")], { encoding: "utf8", stdio: "pipe" });
        return "";
    } catch (error) {
        return error.stdout ?? "";
    }
}

test("the shipped tsconfig checks JavaScript too", () => {
    // The plugin writes this one config into the author's scripts directory, and .ts and
    // .js sit there side by side — a jsconfig cannot coexist with a tsconfig over one
    // folder, so this config has to cover both or the JavaScript author gets nothing.
    // check() leaves its plugin.ts behind and tsc compiles the whole directory, so the
    // TypeScript file has to go or its diagnostics answer instead of this one's.
    rmSync(join(workspace, "plugin.ts"), { force: true });
    writeFileSync(join(workspace, "plugin.js"), "export const r = fetch('http://x');\n");
    try {
        const output = execFileSync(process.execPath, [tsc, "-p", workspace], { encoding: "utf8", stdio: "pipe" });
        assert.fail(`expected a diagnostic, got: ${output}`);
    } catch (error) {
        assert.match(error.stdout ?? "", /TS2304|TS2580|TS2584|TS2591/);
    } finally {
        rmSync(join(workspace, "plugin.js"), { force: true });
    }
});

test("the JavaScript sample checks clean against the shipped jsconfig", () => {
    const example = readFileSync(join(fixtures, "rounds.js"), "utf8");
    assert.equal(checkJs(example), "");
});

test("checkJs still catches the globals a bare V8 does not have", () => {
    // The reason jsconfig exists at all: without checkJs a JavaScript author's first
    // sign that fetch is missing is a dead plugin on a live server.
    assert.match(checkJs("export const r = fetch('http://x');\n"), /TS2304|TS2580|TS2584|TS2591/);
    assert.match(checkJs("export const r = process.env;\n"), /TS2304|TS2580|TS2584|TS2591/);
});

test("checkJs catches a wrong event name in JavaScript too", () => {
    assert.match(checkJs('on("no_such_event", () => {});\n'), /TS2345|TS2769/);
});
