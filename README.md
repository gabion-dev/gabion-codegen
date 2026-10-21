# gabion-codegen

The manifest schema of a project created with Gabion, and the code generators
built on it and on the project's OpenAPI spec. The package is a regular
dependency of the project's `frontend/package.json`, so the production build
(and any clean clone) regenerates its derived sources with nothing but Node.js:

- `gabion-generate-module-loader` — `src/generated/module-loader.ts` from `gabion.manifest.json`
- `gabion-generate-manifest-records` — the Java records and enums the backend reads
  `gabion.manifest.json` into, from the manifest schema; takes the output directory
  as its argument (the backend build runs it before compiling)
- `gabion-generate-status-unions` — status unions, API wrappers, type guards and the generated index from `backend/build/openapi.json` and the Hey API output
- `gabion-generate-form-parsers` — typed parse/submit functions for `*Request` Zod schemas

The frontend generators run from the frontend directory (`npm run …` inside
`frontend/`) and derive all paths from it.

The library entry exports the manifest schema (`gabionManifestSchema` and the
types inferred from it), the manifest reader (`readManifestFile`) and the
generators, so every tool that reads a manifest judges it by the same
description. `gabion-codegen/manifest` exports the schema alone, for code that
runs where there is no file system (a browser bundle).
