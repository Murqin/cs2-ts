// The shipped tsconfig is a product promise: whatever the server cannot run must fail
// on the author's machine. Only tsc can check that promise, so it is checked here
// rather than from the host tests.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const shippedConfig = join(here, "..", "..", "..", "templates", "tsconfig.json");
const tsc = join(here, "..", "node_modules", "typescript", "bin", "tsc");

let workspace;

before(() => {
    workspace = mkdtempSync(join(tmpdir(), "cs2ts-tsconfig-"));
    copyFileSync(shippedConfig, join(workspace, "tsconfig.json"));
});

after(() => rmSync(workspace, { recursive: true, force: true }));

/** Returns the tsc diagnostics for a single-file project using the shipped config. */
function check(source) {
    writeFileSync(join(workspace, "plugin.ts"), source);
    try {
        execFileSync(process.execPath, [tsc, "-p", workspace], { encoding: "utf8", stdio: "pipe" });
        return "";
    } catch (error) {
        return error.stdout ?? "";
    }
}

const rejected = {
    // TS1294 is the erasableSyntaxOnly diagnostic. Asserting the code rather than the
    // message keeps the test from breaking on TypeScript's wording.
    enum: ["enum Team { T, CT }\nexport { Team };\n", "TS1294"],
    namespace: ["namespace N { export const x = 1; }\nexport { N };\n", "TS1294"],
    "parameter property": ["export class A { constructor(private x: number) {} }\n", "TS1294"],
    "import alias": ["import F = require('./other.ts');\nexport { F };\n", "TS1294"],
};

for (const [name, [source, code]] of Object.entries(rejected)) {
    test(`rejects ${name}`, () => {
        assert.match(check(source), new RegExp(code));
    });
}

// Bare V8 has none of these. Without lib and types pinned down they type-check happily
// and fail only once the plugin runs on a server.
const absentGlobals = {
    fetch: "export const r = fetch('http://x');\n",
    process: "export const r = process.env;\n",
    setTimeout: "export const r = setTimeout(() => {}, 1);\n",
    console: "export const r = console.log('x');\n",
    require: "export const r = require('fs');\n",
};

for (const [name, source] of Object.entries(absentGlobals)) {
    test(`rejects the absent global '${name}'`, () => {
        assert.match(check(source), /TS2304|TS2580|TS2584|TS2591/);
    });
}

test("accepts the const-object replacement for enum", () => {
    const source = [
        "export const Team = { Spectator: 1, T: 2, CT: 3 } as const;",
        "export type Team = (typeof Team)[keyof typeof Team];",
        "export function isPlaying(team: Team): boolean {",
        "    return team === Team.T || team === Team.CT;",
        "}",
        "",
    ].join("\n");
    assert.equal(check(source), "");
});

test("accepts importing a sibling plugin file by its .ts path", () => {
    writeFileSync(join(workspace, "other.ts"), "export const value = 1;\n");
    assert.equal(check("import { value } from './other.ts';\nexport const doubled = value * 2;\n"), "");
    rmSync(join(workspace, "other.ts"));
});
