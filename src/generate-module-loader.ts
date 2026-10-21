// src/generate-module-loader.ts
/**
 * Generates frontend/src/generated/module-loader.ts from gabion.manifest.json.
 *
 * Each installed module must export init(): void from its index.ts.
 * Generated file provides initModules() that calls all module init functions.
 *
 * Module directory is styleDir: the canonical short directory name used
 * across all module directories (frontend, styles, templates). The
 * manifest is read through the schema, so an entry without one never
 * reaches the generator.
 *
 * Modules with devOnly: true in manifest are wrapped in __DEV__ guard.
 * In production builds, esbuild eliminates the dead code branch and
 * tree-shakes the unused import — devOnly module code is not in the bundle.
 *
 * Idempotent: only writes when content changes (preserves mtime).
 * Invoked as an npm script of the frontend (working directory =
 * frontend/); the development runtime runs the same script by name.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

import { readManifestFile } from "./manifest-io.js";
import type { ManifestModule } from "./manifest-schema.js";
import { resolveGeneratorPaths } from "./paths.js";

// ==========================================
// Generation
// ==========================================

/**
 * The frontend directory name of a module: styleDir, the single source of
 * truth for module directory names across all layers — modules_frontend,
 * modules_styles, modules_templates.
 */
function resolveModuleDir(mod: ManifestModule): string {
  return mod.styleDir;
}

function generateContent(modules: readonly ManifestModule[]): string {
  const sorted = [...modules].sort((a, b) =>
    resolveModuleDir(a).localeCompare(resolveModuleDir(b)),
  );

  const imports = sorted
    .map((mod) => {
      const dir = resolveModuleDir(mod);
      return `import { init as init${toPascalCase(dir)} } from '../modules_frontend/${dir}';`;
    })
    .join("\n");

  const calls = sorted
    .map((mod) => {
      const dir = resolveModuleDir(mod);
      const call = `  init${toPascalCase(dir)}();`;
      if (mod.devOnly === true) {
        return `  if (__DEV__) {\n  ${call}\n  }`;
      }
      return call;
    })
    .join("\n");

  return [
    "// AUTO-GENERATED from gabion.manifest.json — do not edit manually",
    "// Regenerate: npm run generate:modules (in frontend/)",
    "",
    imports,
    "",
    "/**",
    " * Initialize all installed Gabion modules.",
    " * Each module checks its own DOM preconditions in init().",
    " * Modules with devOnly: true are excluded from production builds",
    " * via __DEV__ guard + esbuild dead code elimination.",
    " */",
    "export function initModules(): void {",
    calls,
    "}",
    "",
  ].join("\n");
}

function toPascalCase(str: string): string {
  return str
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// ==========================================
// Public API
// ==========================================

/**
 * Generate module-loader.ts from the project manifest.
 *
 * @param frontendDir  The frontend directory the generator runs for;
 *   defaults to the working directory, which is how the npm script
 *   invokes it.
 * @returns true if the file was written (content changed), false if unchanged.
 */
export function generateModuleLoader(frontendDir?: string): boolean {
  const paths = resolveGeneratorPaths(frontendDir);
  const manifestPath = paths.manifestPath;
  const outputPath = `${paths.generatedDir}/module-loader.ts`;

  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest = readManifestFile(manifestPath);
  const newContent = generateContent(manifest.installedModules);

  // Idempotent: skip if content unchanged
  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath, "utf-8");
    if (existing === newContent) {
      return false;
    }
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, newContent, "utf-8");
  return true;
}
