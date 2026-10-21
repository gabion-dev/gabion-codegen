// src/manifest-io.ts
/**
 * Reading gabion.manifest.json: parse the file and check its shape
 * against the manifest schema. The one reader every consumer of the
 * manifest goes through — the generators of this package and the
 * development runtime alike — so "what a valid manifest is" is judged
 * in exactly one place.
 *
 * A malformed manifest throws an error naming the file and every
 * offending field, instead of handing readers a value whose type lies:
 * a missing required array once made an accessibility scan cover zero
 * pages while reporting no issues.
 */

import { readFileSync } from "fs";
import { z } from "zod";

import { gabionManifestSchema, type GabionManifest } from "./manifest-schema.js";

/** A manifest file that is not JSON, or whose JSON is not a Gabion manifest. */
export class ManifestShapeError extends Error {
  constructor(
    readonly manifestPath: string,
    readonly problems: string,
  ) {
    super(`${manifestPath} is not a valid Gabion manifest:\n${problems}`);
    this.name = "ManifestShapeError";
  }
}

/** Check a parsed value against the manifest schema. */
export function checkManifestShape(manifestPath: string, value: unknown): GabionManifest {
  const result = gabionManifestSchema.safeParse(value);
  if (!result.success) {
    throw new ManifestShapeError(manifestPath, z.prettifyError(result.error));
  }
  return result.data;
}

/**
 * Read, parse and check a manifest file at an explicit path — the
 * project's own, or a template's or package's copy.
 */
export function readManifestFile(manifestPath: string): GabionManifest {
  const raw = readFileSync(manifestPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestShapeError(manifestPath, err instanceof Error ? err.message : String(err));
  }
  return checkManifestShape(manifestPath, parsed);
}
