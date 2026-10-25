// src/manifest-schema.ts
/**
 * Gabion Manifest — the schema of gabion.manifest.json, the types derived
 * from it, and the names its object and enum schemas carry across
 * languages.
 *
 * The schema is the single source: every TypeScript type below is
 * inferred from it, and the Java records the backend reads the manifest
 * into are generated from it (generate-manifest-records.ts), so the shape
 * a reader is promised and the shape the reader checks cannot drift apart
 * — on either side of the language boundary. Objects are strict: a key
 * the schema does not know is refused, not dropped. The manifest is
 * written back after it is read, and a silently dropped key would be
 * lost data, while a silently accepted one is a typo nobody sees.
 *
 * The schema lives in this package rather than in the development
 * runtime because the production build of a project — a clean clone with
 * nothing but a JDK and Node.js — generates the backend's manifest records
 * from it, and the runtime is not there. The runtime depends on this
 * package for the same schema.
 *
 * Numbers that order things (navOrder, order) are integers: the Java
 * side reads them as int, and a fraction accepted here would be refused
 * there — one schema must mean one thing in both languages.
 */

import { z } from "zod";

/** Access level for pages and modules. */
export const pageSpaceSchema = z.enum(["public", "protected", "admin", "super-admin"]);
export type PageSpace = z.infer<typeof pageSpaceSchema>;

/** Where a page is linked from in the site's own navigation. */
export const navPlacementSchema = z.enum(["header", "footer"]);
export type NavPlacement = z.infer<typeof navPlacementSchema>;

const stringList = z.array(z.string()).readonly();

/**
 * A Maven coordinate `group:artifact:version` — three non-empty parts,
 * no whitespace. Only the shape is judged here: whether the artifact
 * exists is the build's question, answered by Gradle resolution.
 */
const mavenCoordinateSchema = z
  .string()
  .regex(/^[^\s:]+:[^\s:]+:[^\s:]+$/, "a Maven coordinate group:artifact:version");

/** Page entry within a Gabion module manifest. */
export const manifestPageSchema = z
  .strictObject({
    name: z.string(),
    path: z.string().nullable(),
    /**
     * The page's name: its navigation label, its browser-tab title and the
     * title of its Markdown form. Required for every page with a path — the
     * backend refuses to start without it rather than invent one.
     */
    title: z.string().optional(),
    /**
     * What the page covers, for someone reading a list of results rather
     * than the page: meta description, site index notes, Markdown front
     * matter. Absent means none is published.
     */
    description: z.string().optional(),
    /** Where the page is linked from; absent means nowhere. */
    nav: z.array(navPlacementSchema).readonly().optional(),
    /** Sort order within navigation and within the site index. */
    navOrder: z.int().nullable().optional(),
    /** Override space for this specific page (defaults to module space). */
    space: pageSpaceSchema.optional(),
    /**
     * The site the page belongs to, by the identifier a module declares
     * through the hosting contract. Absent means every site — and on an
     * application that does not tell sites apart, every page is absent of
     * it. Two pages may share a path only when each names a different site;
     * the backend refuses anything else at startup.
     */
    site: z.string().optional(),
    /**
     * The link-preview card's own title, when it should read differently
     * from the page's title — a card is read on its own, in a chat or a
     * feed. Absent means the card repeats the title. Public pages only: the
     * backend refuses card text on any other page at startup.
     */
    cardTitle: z.string().optional(),
    /**
     * The link-preview card's own description; absent means the card
     * repeats the page's description. Public pages only, as cardTitle.
     */
    cardDescription: z.string().optional(),
  })
  .readonly();
export type ManifestPage = z.infer<typeof manifestPageSchema>;

/** Section entry for aggregator pages (account/admin/super-admin/user-detail). */
export const manifestSectionSchema = z
  .strictObject({
    id: z.string(),
    label: z.string(),
    order: z.int(),
  })
  .readonly();
export type ManifestSection = z.infer<typeof manifestSectionSchema>;

const sectionList = z.array(manifestSectionSchema).readonly();

/** Sections contributed by a module to aggregator pages. */
export const manifestSectionsSchema = z
  .strictObject({
    account: sectionList.optional(),
    admin: sectionList.optional(),
    "super-admin": sectionList.optional(),
    "user-detail": sectionList.optional(),
  })
  .readonly();
export type ManifestSections = z.infer<typeof manifestSectionsSchema>;

/**
 * A business action a module gates with the authorization contract,
 * declared so the administrator's screen can offer it. The identifier is
 * `<module>.<action>` with the module's unscoped name (`@gabion/voicemail-standard`
 * declares `voicemail-standard.listen`): grants are stored under it, so it
 * never changes between releases — a changed identifier silently drops
 * every grant. The backend refuses an identifier outside the module's
 * own prefix and two modules claiming one identifier.
 */
export const manifestPermissionSchema = z
  .strictObject({
    id: z.string(),
    /** What the action lets a user do, for the administrator's screen. */
    label: z.string(),
    /**
     * The role whose holders may perform the action until an administrator
     * decides otherwise for this installation; the role hierarchy applies,
     * so `USER` means every signed-in user. Absent means nobody until
     * granted — the module's own default, not the installation's decision.
     */
    defaultRole: z.string().optional(),
  })
  .readonly();
export type ManifestPermission = z.infer<typeof manifestPermissionSchema>;

/** User menu item declared by a module for the authenticated user dropdown. */
export const manifestUserMenuItemSchema = z
  .strictObject({
    id: z.string(),
    label: z.string(),
    path: z.string(),
    order: z.int(),
    requiresRole: z.string().optional(),
  })
  .readonly();
export type ManifestUserMenuItem = z.infer<typeof manifestUserMenuItemSchema>;

/** Installed module descriptor in gabion.manifest.json. */
export const manifestModuleSchema = z
  .strictObject({
    name: z.string(),
    version: z.string(),
    level: z.string().optional(),
    installedAt: z.string().optional(),
    devOnly: z.boolean().optional(),
    space: pageSpaceSchema,
    styleDir: z.string(),
    files: stringList,
    provides: stringList,
    requires: stringList,
    optional: stringList,
    pages: z.array(manifestPageSchema).readonly(),
    sections: manifestSectionsSchema.optional(),
    userMenu: z.array(manifestUserMenuItemSchema).readonly().optional(),
    /**
     * The business actions the module gates with the authorization
     * contract (see manifestPermissionSchema); absent means the module
     * gates nothing.
     */
    permissions: z.array(manifestPermissionSchema).readonly().optional(),
    /**
     * CSS file names (relative to modules_styles/{styleDir}/) the auth
     * layout links on every auth-flow page. Auth pages live outside the
     * page system, so these files bind through this declaration instead
     * of the page-name map; the declaration is the single source — the
     * layout renders its links from it, and the orphan-CSS warning
     * treats declared files as bound.
     */
    authStyles: stringList.optional(),
    /**
     * CSS files (relative to modules_styles/{styleDir}/) shared by a named
     * group of pages: file name → page names it binds to. The file-name
     * convention binds a root-level file to exactly one page; a file
     * several pages need — but not all of the module's pages — binds
     * through this declaration instead, and to the listed pages only.
     * The orphan-CSS warning treats a declared file as bound; a listed
     * page the module does not declare, or a declared file missing on
     * disk, is reported loudly at startup.
     */
    sharedStyles: z.record(z.string(), stringList).readonly().optional(),
    /** Whether this module has Flyway migrations in db/migration/{styleDir}/. */
    hasMigrations: z.boolean().optional(),
    /** Base paths for public API endpoints; SecurityConfig suffixes with /**. */
    apiBasePaths: stringList.optional(),
    /**
     * Public answers of the module that are neither pages nor API:
     * a feed, security.txt, a file of the module's own. Exact
     * paths or path patterns, permitted as written (never suffixed) and
     * only for `space: "public"`; kept out of routes, navigation and the
     * accessibility scan because they are not pages.
     */
    publicResourcePaths: stringList.optional(),
    /**
     * Framework lint rules an eslint-disable directive may name in
     * specific files of this module: file path relative to
     * modules_frontend/{styleDir}/ → rule names. Only a devOnly module
     * may declare it — a file whose subject IS the bypass (a demo of an
     * unprotected request) never reaches production. Exact file paths,
     * no patterns: a grant is bound to the files that justify it. The
     * project's eslint.config.js composes the grants from this
     * declaration, so they leave with the module.
     */
    suppressibleRules: z.record(z.string(), stringList).readonly().optional(),
    /**
     * Frontend files of this module that nothing imports by design —
     * fixtures swapped in by tooling, files loaded by name — as patterns
     * relative to modules_frontend/{styleDir}/. The project's knip
     * config keeps them out of the TypeScript dead-code check, so the
     * exception leaves with the module.
     */
    unreferencedFiles: stringList.optional(),
    /**
     * Java libraries this module's backend needs beyond the template's,
     * as Maven coordinates `group:artifact:version`. The project's build
     * declares them from this list (implementation for a production
     * module, developmentOnly for a devOnly one) and refuses a version
     * the resolution changed, so a module's library has one owner — the
     * module — and leaves with it. The module's frontend dependencies
     * are not here: its own package.json in modules_frontend/{styleDir}/
     * declares them, and npm owns that file.
     */
    javaDependencies: z.array(mavenCoordinateSchema).readonly().optional(),
    /** Git tag marking the baseline state at install/restore/replace time. */
    baselineTag: z.string().optional(),
  })
  .readonly();
export type ManifestModule = z.infer<typeof manifestModuleSchema>;

/** Starter feature opt-out flags. Absent key = default applies. */
export const starterFeaturesSchema = z
  .strictObject({
    navigation: z.boolean().optional(),
    footer: z.boolean().optional(),
    themeToggle: z.boolean().optional(),
  })
  .readonly();
export type StarterFeatures = z.infer<typeof starterFeaturesSchema>;

/** Starter kit descriptor. */
export const manifestStarterSchema = z
  .strictObject({
    name: z.string(),
    version: z.string(),
    features: starterFeaturesSchema,
    files: stringList,
    themes: stringList,
  })
  .readonly();
export type ManifestStarter = z.infer<typeof manifestStarterSchema>;

/** Record of a module replaced during solution installation. */
export const replacedModuleRecordSchema = z
  .strictObject({
    original: z.string(),
    replacement: z.string(),
  })
  .readonly();
export type ReplacedModuleRecord = z.infer<typeof replacedModuleRecordSchema>;

/** Record of an installed solution in the project manifest. */
export const installedSolutionSchema = z
  .strictObject({
    name: z.string(),
    version: z.string(),
    installedAt: z.string(),
    modules: stringList,
    replacedModules: z.array(replacedModuleRecordSchema).readonly(),
    starter: z.string().nullable(),
    previousStarter: z.string().nullable(),
  })
  .readonly();
export type InstalledSolution = z.infer<typeof installedSolutionSchema>;

/**
 * One entry of requiredRuleBundles in gabion.manifest.json. Carries no
 * rule content — only the exact identity of a rule bundle the project
 * requires: a pin is exact ({id, version, sha256}), not a range, so every
 * developer machine runs an identical verification network. A machine
 * whose pool does not contain a matching bundle gets a blocking finding
 * naming the missing policy.
 */
export const requiredRulesBundleSchema = z
  .strictObject({
    id: z.string(),
    version: z.string(),
    /** Content hash of the extracted bundle. */
    sha256: z.string(),
  })
  .readonly();
export type RequiredRulesBundle = z.infer<typeof requiredRulesBundleSchema>;

/** Root structure of gabion.manifest.json. */
export const gabionManifestSchema = z
  .strictObject({
    gabionVersion: z.string(),
    /** Human-readable project name for registry and CLI display. */
    projectName: z.string().optional(),
    /**
     * Extra gateway names the instance answers to, besides its own. The
     * development runtime's instance registry reads them on its own,
     * tolerantly — instance identity must never block startup — and
     * reports each entry it drops.
     */
    dnsAliases: stringList.optional(),
    starter: manifestStarterSchema,
    installedModules: z.array(manifestModuleSchema).readonly(),
    installedSolutions: z.array(installedSolutionSchema).readonly().optional(),
    /**
     * Rule bundles this project requires (exact pins). Absent or empty
     * means the framework's base network only. Managed by
     * `gabion rules require/unrequire`.
     */
    requiredRuleBundles: z.array(requiredRulesBundleSchema).readonly().optional(),
  })
  .readonly();
export type GabionManifest = z.infer<typeof gabionManifestSchema>;

// ==========================================
// Named schemas
// ==========================================

/**
 * Every object schema of the manifest under the name it carries in every
 * language: the TypeScript type above and the Java record generated from
 * it share the name. The order is the order generated sources are
 * written in. A nested object schema absent from this table has no name
 * to generate a type under, and the generator refuses it rather than
 * invent one.
 */
export const MANIFEST_OBJECT_SCHEMAS = {
  GabionManifest: gabionManifestSchema,
  ManifestStarter: manifestStarterSchema,
  StarterFeatures: starterFeaturesSchema,
  ManifestModule: manifestModuleSchema,
  ManifestPage: manifestPageSchema,
  ManifestSections: manifestSectionsSchema,
  ManifestSection: manifestSectionSchema,
  ManifestUserMenuItem: manifestUserMenuItemSchema,
  ManifestPermission: manifestPermissionSchema,
  InstalledSolution: installedSolutionSchema,
  ReplacedModuleRecord: replacedModuleRecordSchema,
  RequiredRulesBundle: requiredRulesBundleSchema,
} as const;

/** Every enum schema of the manifest under its cross-language name. */
export const MANIFEST_ENUM_SCHEMAS = {
  PageSpace: pageSpaceSchema,
  NavPlacement: navPlacementSchema,
} as const;
