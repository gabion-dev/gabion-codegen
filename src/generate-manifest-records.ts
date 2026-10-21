// src/generate-manifest-records.ts
/**
 * Generates the Java records and enums the backend reads
 * gabion.manifest.json into, from the manifest schema.
 *
 * The schema is the single description of the manifest's shape; the
 * TypeScript side checks a manifest against it directly, and the Java
 * side reads a manifest into the records generated here with Jackson in
 * strict mode. Both sides therefore refuse the same documents for the
 * same reasons, and a field added to the schema reaches the backend as a
 * compile error where it is not yet read — never as a silently skipped
 * entry.
 *
 * What each schema construct becomes:
 *   - a named object schema          → a public record (components in schema order)
 *   - a named enum schema            → a public enum carrying the manifest spelling
 *   - string / boolean / number      → String / boolean / double (int for integer schemas)
 *   - optional or nullable           → a @Nullable component (a primitive becomes its box)
 *   - array                          → List<E>, copied on construction
 *   - record (string keys)           → Map<String, V>, copied on construction
 *
 * Every component carries the property it is read from: required keys
 * are marked so Jackson refuses a document that lacks them, and a
 * component whose schema does not allow null refuses an explicit null.
 * Primitive components rely on the reader's refusal of null for
 * primitives; the reader enables it with the rest of its strict profile.
 *
 * The generator owns the output directory: a Java file it did not
 * produce in this run is removed, so a type that left the schema cannot
 * survive as a stale file. Writes are idempotent — unchanged content is
 * not rewritten, so a build that depends on the directory sees no change.
 *
 * Invoked by the project's build before the backend compiles, with the
 * output directory as its argument; the development runtime runs the
 * same build.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import type { z } from "zod";

import { MANIFEST_ENUM_SCHEMAS, MANIFEST_OBJECT_SCHEMAS } from "./manifest-schema.js";

// ==========================================
// Constants
// ==========================================

/**
 * The package of every generated type. Project code reads the manifest
 * through these types by this name; it is part of the generated code's
 * contract, like the type names themselves.
 */
export const MANIFEST_RECORDS_JAVA_PACKAGE = "dev.gabion.config.manifest";

const GENERATOR_NAME = "gabion-codegen";

const FILE_HEADER = [
  "// AUTO-GENERATED from the Gabion manifest schema — do not edit manually",
  "// Regenerate: the backend build runs the generator before compiling",
];

const INDENT = "    ";

// ==========================================
// Types
// ==========================================

/** A Java type with the facts the component annotations are derived from. */
interface JavaComponentType {
  /** The Java type as written in the record header. */
  readonly type: string;
  /** Whether the schema allows the key to be absent. */
  readonly required: boolean;
  /** Whether the component may be null (absent or explicitly null). */
  readonly nullable: boolean;
  /** Whether the Java type is a primitive. */
  readonly primitive: boolean;
  /** For List and Map components: the expression copying the value. */
  readonly copy: ((expression: string) => string) | null;
  /** Whether elements (list) or values (map) must refuse null. */
  readonly contentNonNull: boolean;
}

/** A Java source file of the generated package. */
interface GeneratedFile {
  readonly fileName: string;
  readonly content: string;
}

/** The subset of a zod definition this generator reads. */
interface ZodDefinition {
  readonly type: string;
  readonly innerType?: z.ZodType;
  readonly element?: z.ZodType;
  readonly keyType?: z.ZodType;
  readonly valueType?: z.ZodType;
  readonly shape?: Record<string, z.ZodType>;
  readonly format?: string;
}

// ==========================================
// Schema navigation
// ==========================================

function definitionOf(schema: z.ZodType): ZodDefinition {
  return schema.def as unknown as ZodDefinition;
}

/** The schema under its readonly wrapper, when it has one. */
function withoutReadonly(schema: z.ZodType): z.ZodType {
  const def = definitionOf(schema);
  return def.type === "readonly" && def.innerType !== undefined ? withoutReadonly(def.innerType) : schema;
}

/**
 * Names of every registered schema, keyed by the schema object and by
 * the object under its readonly wrapper: a reference to a named schema
 * is the same object wherever it occurs, which is what makes the name
 * findable without any annotation inside the schema.
 */
function buildNameIndex(): Map<z.ZodType, string> {
  const index = new Map<z.ZodType, string>();
  const register = (name: string, schema: z.ZodType): void => {
    index.set(schema, name);
    index.set(withoutReadonly(schema), name);
  };
  for (const [name, schema] of Object.entries(MANIFEST_OBJECT_SCHEMAS)) {
    register(name, schema);
  }
  for (const [name, schema] of Object.entries(MANIFEST_ENUM_SCHEMAS)) {
    register(name, schema);
  }
  return index;
}

const NAME_INDEX = buildNameIndex();

function nameOf(schema: z.ZodType, context: string): string {
  const name = NAME_INDEX.get(schema) ?? NAME_INDEX.get(withoutReadonly(schema));
  if (name === undefined) {
    throw new Error(
      `${context}: the ${definitionOf(schema).type} schema has no name — add it to the ` +
        "named schemas of the manifest schema module so a Java type can be generated for it",
    );
  }
  return name;
}

// ==========================================
// Type mapping
// ==========================================

function boxed(primitive: string): string {
  switch (primitive) {
    case "int":
      return "Integer";
    case "double":
      return "Double";
    case "boolean":
      return "Boolean";
    default:
      return primitive;
  }
}

/** The Java type of a value that is never null: a list element, a map value. */
function nonNullJavaType(schema: z.ZodType, context: string): string {
  const def = definitionOf(withoutReadonly(schema));
  switch (def.type) {
    case "string":
      return "String";
    case "number":
      return def.format === "safeint" ? "Integer" : "Double";
    case "boolean":
      return "Boolean";
    case "enum":
    case "object":
      return nameOf(schema, context);
    case "array":
      if (def.element === undefined) throw new Error(`${context}: array schema without an element`);
      return `List<${nonNullJavaType(def.element, `${context}[]`)}>`;
    case "optional":
    case "nullable":
      throw new Error(
        `${context}: a nullable or optional element is not supported — ` +
          "a Java list or map of nullable values has no honest reading",
      );
    default:
      throw new Error(`${context}: unsupported schema construct '${def.type}'`);
  }
}

/** The Java type of a record component, with the facts its annotations need. */
function componentType(schema: z.ZodType, context: string): JavaComponentType {
  let current = schema;
  let required = true;
  let nullable = false;
  for (;;) {
    const def = definitionOf(current);
    if (def.type === "optional" && def.innerType !== undefined) {
      required = false;
      nullable = true;
      current = def.innerType;
    } else if (def.type === "nullable" && def.innerType !== undefined) {
      nullable = true;
      current = def.innerType;
    } else if (def.type === "readonly" && def.innerType !== undefined) {
      current = def.innerType;
    } else {
      break;
    }
  }

  const def = definitionOf(current);
  const scalar = (primitive: string): JavaComponentType => ({
    type: nullable ? boxed(primitive) : primitive,
    required,
    nullable,
    primitive: !nullable && primitive !== "String",
    copy: null,
    contentNonNull: false,
  });

  switch (def.type) {
    case "string":
      return scalar("String");
    case "number":
      return scalar(def.format === "safeint" ? "int" : "double");
    case "boolean":
      return scalar("boolean");
    case "enum":
    case "object":
      return {
        type: nameOf(current, context),
        required,
        nullable,
        primitive: false,
        copy: null,
        contentNonNull: false,
      };
    case "array": {
      if (def.element === undefined) throw new Error(`${context}: array schema without an element`);
      const element = nonNullJavaType(def.element, `${context}[]`);
      return {
        type: `List<${element}>`,
        required,
        nullable,
        primitive: false,
        copy: (expression) => `List.copyOf(${expression})`,
        contentNonNull: true,
      };
    }
    case "record": {
      if (def.keyType === undefined || def.valueType === undefined) {
        throw new Error(`${context}: record schema without key and value types`);
      }
      if (definitionOf(withoutReadonly(def.keyType)).type !== "string") {
        throw new Error(`${context}: only string-keyed records map to a Java Map`);
      }
      const value = nonNullJavaType(def.valueType, `${context}{}`);
      return {
        type: `Map<String, ${value}>`,
        required,
        nullable,
        primitive: false,
        copy: (expression) => `Map.copyOf(${expression})`,
        contentNonNull: true,
      };
    }
    default:
      throw new Error(`${context}: unsupported schema construct '${def.type}'`);
  }
}

// ==========================================
// Naming
// ==========================================

/** "super-admin" → "superAdmin": a manifest key as a Java identifier. */
function toJavaIdentifier(key: string): string {
  return key
    .split("-")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** "super-admin" → "SUPER_ADMIN": a manifest value as an enum constant. */
function toEnumConstant(value: string): string {
  return value.replace(/-/g, "_").toUpperCase();
}

// ==========================================
// Java source
// ==========================================

function javaFile(imports: readonly string[], body: readonly string[]): string {
  const sortedImports = [...new Set(imports)].sort((a, b) => a.localeCompare(b));
  return [
    ...FILE_HEADER,
    `package ${MANIFEST_RECORDS_JAVA_PACKAGE};`,
    "",
    ...sortedImports.map((name) => `import ${name};`),
    "",
    ...body,
    "",
  ].join("\n");
}

function packageInfo(): GeneratedFile {
  return {
    fileName: "package-info.java",
    content: [
      ...FILE_HEADER,
      "/**",
      " * The shape of gabion.manifest.json as Java types, generated from the",
      " * manifest schema. A component without {@code @Nullable} is never null:",
      " * the reader refuses a document that lacks it.",
      " */",
      "@NullMarked",
      `package ${MANIFEST_RECORDS_JAVA_PACKAGE};`,
      "",
      "import org.jspecify.annotations.NullMarked;",
      "",
    ].join("\n"),
  };
}

function enumFile(name: string, schema: z.ZodType): GeneratedFile {
  const options = (withoutReadonly(schema) as z.ZodEnum).options as readonly string[];
  const constants = options.map(
    (value, index) =>
      `${INDENT}${toEnumConstant(value)}("${value}")${index === options.length - 1 ? ";" : ","}`,
  );
  const body = [
    "/** The values the manifest schema allows, each with its manifest spelling. */",
    `@Generated("${GENERATOR_NAME}")`,
    `public enum ${name} {`,
    ...constants,
    "",
    `${INDENT}private final String value;`,
    "",
    `${INDENT}${name}(String value) {`,
    `${INDENT}${INDENT}this.value = value;`,
    `${INDENT}}`,
    "",
    `${INDENT}/** The value as written in the manifest. */`,
    `${INDENT}@JsonValue`,
    `${INDENT}public String value() {`,
    `${INDENT}${INDENT}return value;`,
    `${INDENT}}`,
    "}",
  ];
  return {
    fileName: `${name}.java`,
    content: javaFile(
      ["com.fasterxml.jackson.annotation.JsonValue", "javax.annotation.processing.Generated"],
      body,
    ),
  };
}

function componentAnnotations(key: string, type: JavaComponentType): string[] {
  const annotations: string[] = [];
  annotations.push(
    type.required ? `@JsonProperty(value = "${key}", required = true)` : `@JsonProperty("${key}")`,
  );
  const nulls: string[] = [];
  if (!type.nullable && !type.primitive) nulls.push("nulls = Nulls.FAIL");
  if (type.contentNonNull) nulls.push("contentNulls = Nulls.FAIL");
  if (nulls.length > 0) annotations.push(`@JsonSetter(${nulls.join(", ")})`);
  if (type.nullable) annotations.push("@Nullable");
  return annotations;
}

function recordFile(name: string, schema: z.ZodType): GeneratedFile {
  const shape = definitionOf(withoutReadonly(schema)).shape;
  if (shape === undefined) throw new Error(`${name}: not an object schema`);

  const imports = [
    "com.fasterxml.jackson.annotation.JsonProperty",
    "javax.annotation.processing.Generated",
  ];
  const components: string[] = [];
  const copies: string[] = [];
  const entries = Object.entries(shape);

  entries.forEach(([key, fieldSchema], index) => {
    const type = componentType(fieldSchema, `${name}.${key}`);
    const identifier = toJavaIdentifier(key);
    const annotations = componentAnnotations(key, type);
    if (annotations.some((annotation) => annotation.startsWith("@JsonSetter"))) {
      imports.push("com.fasterxml.jackson.annotation.JsonSetter", "com.fasterxml.jackson.annotation.Nulls");
    }
    if (type.nullable) imports.push("org.jspecify.annotations.Nullable");
    if (type.type.includes("List<")) imports.push("java.util.List");
    if (type.type.startsWith("Map<")) imports.push("java.util.Map");

    const terminator = index === entries.length - 1 ? ") {" : ",";
    components.push(`${INDENT}${INDENT}${annotations.join(" ")} ${type.type} ${identifier}${terminator}`);

    if (type.copy !== null) {
      copies.push(
        type.nullable
          ? `${INDENT}${INDENT}${identifier} = ${identifier} == null ? null : ${type.copy(identifier)};`
          : `${INDENT}${INDENT}${identifier} = ${type.copy(identifier)};`,
      );
    }
  });

  const body = [
    "/** One object of the manifest schema; the components are its properties in schema order. */",
    `@Generated("${GENERATOR_NAME}")`,
    `public record ${name}(`,
    ...components,
  ];
  if (copies.length > 0) {
    body.push(
      "",
      `${INDENT}/** Lists and maps are held as immutable copies. */`,
      `${INDENT}public ${name} {`,
      ...copies,
      `${INDENT}}`,
    );
  }
  body.push("}");

  return { fileName: `${name}.java`, content: javaFile(imports, body) };
}

// ==========================================
// Output
// ==========================================

/**
 * Generate the Java sources of the manifest records into a directory,
 * which the generator owns: stale files are removed, unchanged ones are
 * left untouched.
 *
 * @param outputDir  the directory the package's sources are written to;
 *   the package's directory structure is created inside it.
 * @returns the number of files written or removed — zero when the
 *   directory already held exactly this output.
 */
export function generateManifestRecords(outputDir: string): number {
  const packageDir = join(outputDir, ...MANIFEST_RECORDS_JAVA_PACKAGE.split("."));
  mkdirSync(packageDir, { recursive: true });

  const files: GeneratedFile[] = [packageInfo()];
  for (const [name, schema] of Object.entries(MANIFEST_ENUM_SCHEMAS)) {
    files.push(enumFile(name, schema));
  }
  for (const [name, schema] of Object.entries(MANIFEST_OBJECT_SCHEMAS)) {
    files.push(recordFile(name, schema));
  }

  let changes = 0;
  const produced = new Set<string>();
  for (const file of files) {
    produced.add(file.fileName);
    const filePath = join(packageDir, file.fileName);
    if (existsSync(filePath) && readFileSync(filePath, "utf-8") === file.content) {
      continue;
    }
    writeFileSync(filePath, file.content, "utf-8");
    changes += 1;
  }

  for (const entry of readdirSync(packageDir)) {
    if (entry.endsWith(".java") && !produced.has(entry)) {
      unlinkSync(join(packageDir, entry));
      changes += 1;
    }
  }

  return changes;
}
