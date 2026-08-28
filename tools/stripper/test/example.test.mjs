// The shipped tsconfig, the shipped declarations and the example script have to agree.
// Each one is easy to change without noticing the other two, and the failure only shows
// up as an author's first script refusing to compile.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "..", "..", "..");
const tsc = join(here, "..", "node_modules", "typescript", "bin", "tsc");

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

test("the example script compiles against the shipped tsconfig", () => {
    const example = readFileSync(join(repository, "examples", "scripts", "welcome.ts"), "utf8");
    assert.equal(check(example), "");
});

test("an unknown event name is rejected", () => {
    assert.match(check('on("no_such_event", () => {});\n'), /TS2345|TS2769/);
});

test("a handler with the wrong signature is rejected", () => {
    assert.match(check('on("round_start", (player: Player) => {});\n'), /TS2345|TS2769/);
});

test("resolve() returns something the script has to narrow itself", () => {
    // The escape hatch is untyped on purpose; using it as if it were typed must fail.
    assert.match(check('on("player_death", (p: Player) => { p.resolve().Health; });\n'), /TS2339|TS2571|TS18046/);
});

test("isValid and id are usable without narrowing", () => {
    assert.equal(check('on("player_death", (p: Player) => { if (p.isValid) { p.id.toFixed(0); } });\n'), "");
});

test("the facade's writable members are writable and its readable ones are not", () => {
    assert.equal(check('on("player_spawn", (p: Player) => { p.health = 100; p.armor = 50; p.money = 16000; });\n'), "");

    // name and team describe the player; writing them would look like it worked.
    assert.match(check('on("player_spawn", (p: Player) => { p.name = "x"; });\n'), /TS2540/);
    assert.match(check('on("player_spawn", (p: Player) => { p.team = 2; });\n'), /TS2540/);
});

test("a position is a copy, and the compiler says so", () => {
    // The whole reason position is not CounterStrikeSharp's Vector: a script that
    // mutated one would be writing into entity memory, and this must not compile.
    assert.match(check('on("player_spawn", (p: Player) => { p.position.x = 0; });\n'), /TS2540/);
    assert.equal(check('on("player_spawn", (p: Player) => { p.teleport(p.position.x, p.position.y, p.position.z + 64); });\n'), "");
});

test("steamId is a string, because a 64-bit id is not a JavaScript number", () => {
    assert.equal(check('on("player_connect", (p: Player) => { p.sendChat(p.steamId.slice(0, 4)); });\n'), "");
    assert.match(check('on("player_connect", (p: Player) => { p.steamId.toFixed(0); });\n'), /TS2339|TS2551/);
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

test("the timer example compiles against the shipped tsconfig", () => {
    const example = readFileSync(join(repository, "examples", "scripts", "timers.ts"), "utf8");
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
            'on("player_spawn", (p: Player): void => {',
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
        check('on("player_spawn", (p: Player) => { unsafe.pawn(p).Health; });\n'),
        /TS2339|TS2571|TS18046/);
});

test("there is no setString to reach for", () => {
    // Its absence is a decision, not an oversight: CounterStrikeSharp's string setter
    // writes a pointer where its getter reads characters. If it ever appears here it
    // should be because someone meant it.
    assert.match(
        check('on("player_spawn", (p: Player) => { unsafe.setString(unsafe.pawn(p), "C", "f", "x"); });\n'),
        /TS2339|TS2551/);
});

test("the escape hatch's value types are checked", () => {
    assert.match(
        check('on("player_spawn", (p: Player) => { unsafe.setBool(unsafe.pawn(p), "C", "f", 1); });\n'),
        /TS2345|TS2769/);
    assert.match(
        check('on("player_spawn", (p: Player) => { unsafe.setInt(unsafe.pawn(p), "C", "f"); });\n'),
        /TS2554/);
    assert.match(
        check('on("player_spawn", (p: Player) => { const n: number = unsafe.getString(unsafe.pawn(p), "C", "f"); });\n'),
        /TS2322/);
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

test("the JavaScript example checks clean against the shipped jsconfig", () => {
    const example = readFileSync(join(repository, "examples", "scripts", "rounds.js"), "utf8");
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
