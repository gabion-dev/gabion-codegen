#!/usr/bin/env node
// src/cli/generate-manifest-records.ts
// Command-line entry point of the generator (an npm bin). The shebang
// must be the first line for Node to execute it; the generator itself
// lives in the library module and always runs here — there is no
// "am I the main module" guard, because a guard that misjudges the
// invocation (npm runs bins through a symlink) would exit green
// without generating anything.
//
// The output directory is the single argument: the build that compiles
// the generated sources owns their location, so it names it here rather
// than this package guessing a layout.

import { resolve } from "path";

import { generateManifestRecords } from "../generate-manifest-records.js";

const outputArgument = process.argv[2];
if (outputArgument === undefined || outputArgument.length === 0) {
  console.error("Usage: gabion-generate-manifest-records <output-directory>");
  process.exit(1);
}

const outputDir = resolve(outputArgument);
const changes = generateManifestRecords(outputDir);
console.log(
  changes === 0
    ? `manifest records unchanged in ${outputDir}`
    : `manifest records generated in ${outputDir} (${String(changes)} file(s) written or removed)`,
);
