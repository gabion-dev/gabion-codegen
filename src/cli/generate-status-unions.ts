#!/usr/bin/env node
// src/cli/generate-status-unions.ts
// Command-line entry point of the generator (an npm bin). The shebang
// must be the first line for Node to execute it; the generator itself
// lives in the library module and always runs here — there is no
// "am I the main module" guard, because a guard that misjudges the
// invocation (npm runs bins through a symlink) would exit green
// without generating anything.

import { generateStatusUnions } from "../generate-status-unions.js";

await generateStatusUnions();
