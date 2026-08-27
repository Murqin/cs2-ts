// Produces the embedded stripper script. The output is gzipped because it ships inside
// the plugin assembly: 3.6 MB of minified JavaScript compresses to about 1 MB, and the
// host has to decompress it once per process either way.

import { build } from "esbuild";
import { gzipSync, constants } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(here, "..", "..", "src", "Cs2Ts.Runtime", "Resources");
const scriptPath = join(outputDirectory, "stripper.js");
const packedPath = join(outputDirectory, "stripper.js.gz");

const result = await build({
    entryPoints: [join(here, "src", "entry.js")],
    bundle: true,
    // The stripper engine has no module loader and no host globals, so the bundle has
    // to be a self-contained script that installs itself onto globalThis.
    format: "iife",
    // "browser" resolution is what makes this work without Node: it applies the
    // typescript package's own browser field, which stubs out fs, os, path and crypto.
    // "node" would leave real require() calls in the bundle.
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    outfile: scriptPath,
    metafile: true,
});

const script = readFileSync(scriptPath);
const packed = gzipSync(script, { level: constants.Z_BEST_COMPRESSION });

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(packedPath, packed);

const versions = ["ts-blank-space", "typescript"].map((name) => {
    const manifest = JSON.parse(readFileSync(join(here, "node_modules", name, "package.json"), "utf8"));
    return `${name}@${manifest.version}`;
});

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(`stripper bundle: ${versions.join(", ")}`);
console.log(`  script  ${kb(script.length)}`);
console.log(`  packed  ${kb(packed.length)}  -> ${packedPath}`);

if (result.errors.length > 0) {
    process.exitCode = 1;
}
