// src/paths.ts
/**
 * Path conventions shared by the generators. Every generator is invoked
 * from the frontend directory (an npm script of frontend/package.json),
 * so the frontend directory is the working directory and the project
 * root is its parent. No environment variable and no derivation from
 * the package's own location: the generators must resolve the same
 * paths whether the package is linked from a workspace or installed
 * from the registry.
 */

import { join, resolve } from "path";

export interface GeneratorPaths {
  readonly frontendDir: string;
  readonly projectRoot: string;
  readonly generatedDir: string;
  readonly manifestPath: string;
  readonly openApiSpecPath: string;
}

export function resolveGeneratorPaths(frontendDir: string = process.cwd()): GeneratorPaths {
  const resolvedFrontend = resolve(frontendDir);
  const projectRoot = resolve(resolvedFrontend, "..");
  return {
    frontendDir: resolvedFrontend,
    projectRoot,
    generatedDir: join(resolvedFrontend, "src", "generated"),
    manifestPath: join(projectRoot, "gabion.manifest.json"),
    openApiSpecPath: join(projectRoot, "backend", "build", "openapi.json"),
  };
}
