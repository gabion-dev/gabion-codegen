// src/index.ts
/**
 * The library surface of the package: the manifest schema with its
 * types, the manifest reader, and the generators the command-line
 * entries wrap. The development runtime imports the reader from here,
 * so the manifest's shape is described exactly once. The schema alone
 * is also the package's manifest entry (gabion-codegen/manifest): it
 * needs nothing of Node's, and a browser bundle that reaches the schema
 * must not be made to resolve the generators' file-system imports.
 */

export * from "./manifest-schema.js";
export { ManifestShapeError, checkManifestShape, readManifestFile } from "./manifest-io.js";
export { generateModuleLoader } from "./generate-module-loader.js";
export { generateManifestRecords, MANIFEST_RECORDS_JAVA_PACKAGE } from "./generate-manifest-records.js";
