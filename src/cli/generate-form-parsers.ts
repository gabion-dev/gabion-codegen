#!/usr/bin/env node
// src/cli/generate-form-parsers.ts
// Command-line entry point of the generator (an npm bin). The shebang
// must be the first line for Node to execute it; the generator itself
// lives in the library module and always runs here — there is no
// "am I the main module" guard, because a guard that misjudges the
// invocation (npm runs bins through a symlink) would exit green
// without generating anything.

import { generateFormParsers } from "../generate-form-parsers.js";
import { resolveGeneratorPaths } from "../paths.js";

const paths = resolveGeneratorPaths();
const changed = generateFormParsers(paths.generatedDir, paths.openApiSpecPath);
console.log(changed ? "form parsers generated" : "form parsers unchanged");
