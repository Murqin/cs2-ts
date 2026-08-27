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
    assert.match(check('on("round_start", (player: PlayerHandle) => {});\n'), /TS2345|TS2769/);
});

test("resolve() returns something the script has to narrow itself", () => {
    // The escape hatch is untyped on purpose; using it as if it were typed must fail.
    assert.match(check('on("player_death", (p: PlayerHandle) => { p.resolve().Health; });\n'), /TS2339|TS2571|TS18046/);
});

test("isValid and id are usable without narrowing", () => {
    assert.equal(check('on("player_death", (p: PlayerHandle) => { if (p.isValid) { p.id.toFixed(0); } });\n'), "");
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
