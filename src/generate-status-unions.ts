// src/generate-status-unions.ts

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

import { resolveGeneratorPaths } from './paths.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GENERATOR_PATHS = resolveGeneratorPaths();
const OPENAPI_PATH = GENERATOR_PATHS.openApiSpecPath;
const OUTPUT_DIR = GENERATOR_PATHS.generatedDir;
const UNIONS_FILE = join(OUTPUT_DIR, 'status-unions.ts');
const WRAPPERS_FILE = join(OUTPUT_DIR, 'api-wrappers.ts');
const INDEX_FILE = join(OUTPUT_DIR, 'index.ts');

const HEY_API_TYPES = './hey-api/types.gen';
const HEY_API_SDK = './hey-api/sdk.gen';

const OPENAPI_TO_TS_TYPE: Record<string, string> = {
  integer: 'number',
  number: 'number',
  string: 'string',
  boolean: 'boolean',
  object: 'Record<string, unknown>',
};

const GUARDS_FILE = join(OUTPUT_DIR, 'type-guards.ts');

const STATUS_LABELS: Record<number, string> = {
  200: 'Success',
  201: 'Created',
  204: 'NoContent',
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  422: 'UnprocessableEntity',
  500: 'ServerError',
  502: 'BadGateway',
  503: 'ServiceUnavailable',
};

// ============================================================================
// TYPES
// ============================================================================

interface OpenAPISpec {
  paths: Record<string, Record<string, EndpointOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

interface EndpointOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  responses: Record<string, ResponseSpec>;
}

interface ResponseSpec {
  description?: string;
  content?: {
    [mediaType: string]: {
      schema?: SchemaRef | PrimitiveSchema | ArraySchema;
    };
  };
}

interface SchemaRef {
  $ref: string;
}

interface PrimitiveSchema {
  type: string;
}

interface ArraySchema {
  type: 'array';
  items: SchemaRef | PrimitiveSchema;
}

interface EndpointInfo {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  responses: Map<number, ResponseInfo>;
}

interface ResponseInfo {
  statusCode: number;
  description?: string;
  typeName: string | null;
  isPrimitive: boolean;
  isArray: boolean;
}

interface ParsedResponseType {
  typeName: string | null;
  isPrimitive: boolean;
  isArray: boolean;
}

// ============================================================================
// UTILITIES
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function isRef(schema: unknown): schema is SchemaRef {
  return schema !== null && typeof schema === 'object' && '$ref' in schema;
}

function isArraySchema(schema: unknown): schema is ArraySchema {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    'type' in schema &&
    (schema as Record<string, unknown>).type === 'array' &&
    'items' in schema
  );
}

function extractTypeNameFromRef(ref: string): string {
  const parts = ref.split('/');
  const last = parts.pop();
  return last ?? 'unknown';
}

function normalizeOperationId(operationId: string): string {
  return operationId.replace(/_(\d+)$/, '$1');
}

function parseResponseType(response: ResponseSpec): ParsedResponseType {
  if (!response.content) {
    return { typeName: null, isPrimitive: false, isArray: false };
  }

  let content = response.content['application/json'];

  if (!content) {
    const contentTypes = Object.keys(response.content);

    if (contentTypes.length === 0) {
      return { typeName: null, isPrimitive: false, isArray: false };
    }

    const firstContentType = contentTypes[0];
    if (firstContentType) {
      content = response.content[firstContentType];
    }
  }

  if (!content || !content.schema) {
    return { typeName: null, isPrimitive: false, isArray: false };
  }

  const schema = content.schema;

  // Direct $ref — single DTO object
  if (isRef(schema)) {
    const typeName = extractTypeNameFromRef(schema.$ref);
    return { typeName, isPrimitive: false, isArray: false };
  }

  // Array with typed items — e.g. Array<RateLimitConfigResponse> or string[]
  if (isArraySchema(schema)) {
    if (isRef(schema.items)) {
      const itemType = extractTypeNameFromRef(schema.items.$ref);
      return { typeName: itemType, isPrimitive: false, isArray: true };
    }
    if ('type' in schema.items && typeof schema.items.type === 'string') {
      const tsType = mapOpenApiTypeToTypeScript(schema.items.type);
      return { typeName: tsType, isPrimitive: true, isArray: true };
    }
    return { typeName: 'unknown', isPrimitive: true, isArray: true };
  }

  // Primitive type — string, integer, boolean, etc.
  if ('type' in schema && typeof schema.type === 'string') {
    return { typeName: schema.type, isPrimitive: true, isArray: false };
  }

  return { typeName: null, isPrimitive: false, isArray: false };
}

/**
 * Maps OpenAPI type to TypeScript type.
 * Converts 'integer' → 'number', etc.
 */
function mapOpenApiTypeToTypeScript(openApiType: string): string {
  return OPENAPI_TO_TS_TYPE[openApiType] ?? openApiType;
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

function parseOpenAPISpec(spec: OpenAPISpec): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];

  console.log('🔍 Parsing OpenAPI specification...\n');

  for (const [route, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation.operationId) {
        console.log(`⚠️  Skipping ${method.toUpperCase()} ${route} - no operationId`);
        continue;
      }

      const responses = new Map<number, ResponseInfo>();

      for (const [statusCode, responseSpec] of Object.entries(operation.responses)) {
        const code = parseInt(statusCode, 10);

        if (isNaN(code)) {
          console.log(
            `⚠️  Skipping non-numeric status: ${statusCode} for ${operation.operationId}`
          );
          continue;
        }

        const { typeName, isPrimitive, isArray } = parseResponseType(responseSpec);

        if (isArray) {
          console.log(
            `   📋 ${operation.operationId}[${code}]: array of ${isPrimitive ? 'primitive' : 'ref'} "${typeName}"`
          );
        } else if (isPrimitive && typeName) {
          console.log(`   📋 ${operation.operationId}[${code}]: primitive type="${typeName}"`);
        }

        responses.set(code, {
          statusCode: code,
          description: responseSpec.description,
          typeName,
          isPrimitive,
          isArray,
        });
      }

      if (responses.size === 0) {
        console.log(`⚠️  No valid responses for ${operation.operationId}`);
        continue;
      }

      endpoints.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path: route,
        summary: operation.summary,
        description: operation.description,
        responses,
      });

      const statusCodes = Array.from(responses.keys()).sort((a, b) => a - b);
      const hasErrors = statusCodes.some((code) => code >= 400);

      if (hasErrors) {
        console.log(
          `✅ ${operation.operationId} (${statusCodes.join(', ')}) - multi-status with errors`
        );
      } else {
        console.log(
          `⚠️  ${operation.operationId} (${statusCodes.join(', ')}) - single response (wrapper for consistency)`
        );
      }
    }
  }

  return endpoints;
}

function generateUnionTypes(endpoints: EndpointInfo[]): string {
  const imports = new Set<string>();
  const unions: string[] = [];

  console.log('\n📝 Generating union types...\n');

  for (const endpoint of endpoints) {
    const unionName = `${capitalize(endpoint.operationId)}Result`;
    const variants: string[] = [];

    for (const [statusCode, response] of endpoint.responses) {
      if (!response.typeName) {
        // No response body (e.g. 204)
        variants.push(`  | { status: ${statusCode} }`);
        console.log(`   📦 ${unionName}[${statusCode}]: no body`);
      } else if (response.isPrimitive) {
        // Primitive type or array of primitives
        const baseType = mapOpenApiTypeToTypeScript(response.typeName);
        const tsType = response.isArray ? `${baseType}[]` : baseType;
        variants.push(`  | { status: ${statusCode}; data: ${tsType} }`);
        console.log(
          `   📦 ${unionName}[${statusCode}]: primitive${response.isArray ? ' array' : ''} → ${tsType}`
        );
      } else {
        // Reference type (DTO) or array of DTOs
        imports.add(response.typeName);
        const fieldName = statusCode >= 400 ? 'error' : 'data';
        const tsType = response.isArray ? `Array<${response.typeName}>` : response.typeName;
        variants.push(`  | { status: ${statusCode}; ${fieldName}: ${tsType} }`);
        console.log(
          `   📦 ${unionName}[${statusCode}]: ref${response.isArray ? ' array' : ''} ${tsType}`
        );
      }
    }

    const statusList = Array.from(endpoint.responses.keys())
      .map((code) => `${code}`)
      .join(', ');

    const jsdoc = `/**
 * Result type for ${endpoint.operationId}
 * 
 * ${endpoint.summary ?? endpoint.description ?? 'No description'}
 * 
 * @description Discriminated union for exhaustive status handling
 * @statuses ${statusList}
 * 
 * @example
 * const result = await ${endpoint.operationId}(...);
 * switch (result.status) {
${Array.from(endpoint.responses.keys())
  .map(
    (code) =>
      `${code >= 400 ? ' *   case ' + code + ': handleError(result.error); break;' : ' *   case ' + code + ': handleSuccess(result.data); break;'}`
  )
  .join('\n')}
 * }
 */`;

    unions.push(`${jsdoc}\nexport type ${unionName} =\n${variants.join('\n')};\n`);

    console.log(`   ✅ ${unionName}`);
  }

  const typeImports = Array.from(imports).sort();

  let header: string;
  if (typeImports.length > 0) {
    header = `// This file is auto-generated by generate-status-unions.ts
// Do not edit manually - changes will be overwritten

import type {
  ${typeImports.join(',\n  ')}
} from '${HEY_API_TYPES}';

`;
  } else {
    header = `// This file is auto-generated by generate-status-unions.ts
// Do not edit manually - changes will be overwritten

`;
  }

  return header + unions.join('\n');
}

function generateWrappers(endpoints: EndpointInfo[]): string {
  console.log('\n📝 Generating wrapper functions...\n');

  const functions: string[] = [];

  for (const endpoint of endpoints) {
    const unionName = `${capitalize(endpoint.operationId)}Result`;
    const normalizedName = normalizeOperationId(endpoint.operationId);
    const errorStatuses = Array.from(endpoint.responses.keys())
      .filter((code) => code >= 400)
      .sort();

    // Documented error branches match directly against the generated
    // discriminated union, one typed branch per status.
    const documentedErrorBranches = errorStatuses
      .map(
        (status) => `    if (status === ${status}) {
      return { status: ${status}, error: (errorBody ?? rawBody) as any };
    }`
      )
      .join('\n');

    const statusList = Array.from(endpoint.responses.keys())
      .map((code) => `${code}`)
      .join(', ');
    const exampleSwitchCases = Array.from(endpoint.responses.keys())
      .map((code) =>
        code >= 400
          ? ` *     case ${code}: showError(result.error); break;`
          : ` *     case ${code}: console.log(result.data); break;`
      )
      .join('\n');

    const jsdoc = `/**
 * ${endpoint.summary ?? 'API call wrapper'}
 * 
 * ${endpoint.description ?? ''}
 * 
 * @description Wraps Hey API call with discriminated union for type-safe
 * handling of documented responses. The real HTTP status is read from
 * response.response.status.
 * 
 *  - Documented success statuses resolve into the success branch.
 *  - Documented 4xx/5xx statuses resolve into typed error branches.
 *  - Undocumented 4xx/5xx statuses are thrown as Error so that callers
 *    handle them via try/catch and extractErrorMessage(). The thrown
 *    Error carries \`status\` and \`body\` properties for inspection.
 *  - Network errors and Zod validation failures propagate as thrown
 *    exceptions from the underlying Hey API call.
 * 
 * @returns Promise with discriminated union (status: ${statusList})
 * 
 * @example
 * try {
 *   const result = await ${endpoint.operationId}(...);
 *   switch (result.status) {
${exampleSwitchCases}
 *     default: {
 *       const _exhaustive: never = result; // TypeScript ERROR if case missed
 *     }
 *   }
 * } catch (e) {
 *   showError(await extractErrorMessage(e, 'Request failed'));
 * }
 * 
 * @note Preserves Hey API auto-validation (Zod schemas)
 * @see OpenAPI operationId: "${endpoint.operationId}"
 * @see Backend: ${endpoint.method} ${endpoint.path}
 */`;

    const successStatuses = Array.from(endpoint.responses.keys())
      .filter((code) => code < 400)
      .sort((a, b) => a - b);
    const successStatus = successStatuses[0] ?? 200;
    const successResponse = endpoint.responses.get(successStatus);
    const hasBody = successResponse?.typeName !== null;

    // Pin Hey API's ThrowOnError generic to `false` so that TypeScript
    // selects the discriminated-union overload that exposes `error`
    // alongside `data`. Without this cast, TS keeps the generic open and
    // the .error field is unreachable on the returned object.
    const sdkCall = `await heyApi.${normalizedName}({ ...options, throwOnError: false as const })`;

    const successReturn = hasBody
      ? `      if (data === undefined || data === null) {
        throw new Error('[${endpoint.operationId}] Response data is missing despite success status');
      }
      return { status: ${successStatus}, data };`
      : `      return { status: ${successStatus} };`;

    // Only declare bindings that the body actually uses — avoids
    // unused-variable warnings for endpoints that neither return a
    // success body nor have documented errors.
    const dataBinding = hasBody ? '  const data = response.data;\n' : '';
    // Every wrapper has an undocumented-error throw path that needs the
    // parsed error body from Hey API. response.error is always available
    // and is the primary source — readErrorBody(httpResponse) is only a
    // fallback because Hey API may have already consumed the raw body.
    const errorBodyBinding = '  const errorBody = response.error;\n';
    const documentedBranches = documentedErrorBranches ? `\n${documentedErrorBranches}\n` : '';
    const throwBodyExpr = '(errorBody ?? rawBody)';

    const functionCode = `${jsdoc}
export async function ${endpoint.operationId}(
  options: Parameters<typeof heyApi.${normalizedName}>[0]
): Promise<Unions.${unionName}> {
  const response = ${sdkCall};
  const httpResponse = response.response;
  if (!httpResponse) {
    throw buildNoResponseError('${endpoint.operationId}', response.error);
  }
  const status = httpResponse.status;
${dataBinding}${errorBodyBinding}
  if (status < 400) {
${successReturn}
  }

  // Read the response body independently of Hey API's parsing so that
  // undocumented error statuses (no responseValidator registered) still
  // surface a useful message downstream via extractErrorMessage().
  const rawBody = await readErrorBody(httpResponse);
${documentedBranches}
  // Undocumented 4xx/5xx — throw for try/catch + extractErrorMessage.
  console.error('[${endpoint.operationId}] Undocumented HTTP status:', status);
  throw buildApiError(status, ${throwBodyExpr});
}`;

    functions.push(functionCode);

    console.log(`   ✅ ${endpoint.operationId}()`);
  }

  const header = `// This file is auto-generated by generate-status-unions.ts
// Do not edit manually - changes will be overwritten

import * as heyApi from '${HEY_API_SDK}';
import * as Unions from './status-unions';

/**
 * Best-effort parse of an error response body when Hey API did not
 * surface one (e.g. endpoint has no responseValidator for that status).
 * The response is cloned so the caller may still consume the original
 * body if needed. Returns null when the body is absent, not JSON, or
 * already consumed.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

/**
 * Extract a user-facing message from the Gabion ErrorResponse DTO shape.
 * Returns null for bodies that do not contain a non-empty \`message\`
 * string, so the caller can fall back to a status-derived default.
 */
function extractMessageFromBody(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  if (!('message' in body)) return null;
  const raw = (body as { message?: unknown }).message;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Build an Error describing an undocumented HTTP failure.
 * The original status code and parsed body are attached as ordinary
 * properties so that callers — or the shared extractErrorMessage()
 * helper — can inspect them without any ambient Error extensions.
 */
function buildApiError(status: number, body: unknown): Error {
  const message = extractMessageFromBody(body) ?? \`HTTP \${status}\`;
  const err = new Error(message);
  Object.assign(err, { status, body });
  return err;
}

/**
 * Build an Error for a call that produced no HTTP response: the request
 * was refused before it was sent (the request validator found the input
 * not matching the API contract) or the network failed. Hey API reports
 * both as an error without a response; the cause is the only account of
 * what went wrong, so it is carried — in the message, readable by the
 * shared extractErrorMessage() helper, and as the Error's cause.
 */
function buildNoResponseError(operationId: string, cause: unknown): Error {
  return new Error(
    \`[\${operationId}] No HTTP response: \${describeNoResponseCause(cause)}\`,
    { cause },
  );
}

/**
 * Describe why a call produced no response. A validation error lists
 * its issues — each the path of the offending input and what is wrong
 * with it; any other error gives its message.
 */
function describeNoResponseCause(cause: unknown): string {
  if (cause !== null && typeof cause === 'object' && 'issues' in cause) {
    const issues = (cause as { issues?: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const described = issues.map((issue: unknown) => {
        if (issue === null || typeof issue !== 'object') return String(issue);
        const path = (issue as { path?: unknown }).path;
        const message = (issue as { message?: unknown }).message;
        const at = Array.isArray(path) && path.length > 0 ? path.map(String).join('.') : 'request';
        return \`\${at}: \${typeof message === 'string' ? message : 'invalid'}\`;
      });
      return \`the request does not match the API contract (\${described.join('; ')})\`;
    }
  }
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return 'the request failed before a response arrived';
}

`;

  return header + functions.join('\n\n');
}

function generateIndex(endpoints: EndpointInfo[]): string {
  console.log('\n📝 Generating index.ts...\n');

  const functionExports = endpoints.map((e) => e.operationId).join(',\n  ');

  // Collect type guard exports for multi-status endpoints
  const guardExports: string[] = ['isSuccess', 'isError'];

  for (const endpoint of endpoints) {
    const statuses = Array.from(endpoint.responses.keys()).sort((a, b) => a - b);
    const hasErrors = statuses.some((code) => code >= 400);

    if (!hasErrors) continue;

    const capName = capitalize(endpoint.operationId);
    const successStatuses = statuses.filter((code) => code < 400);
    const errorStatuses = statuses.filter((code) => code >= 400);

    if (successStatuses.length > 0) {
      guardExports.push(`is${capName}Success`);
    }
    guardExports.push(`is${capName}Error`);

    for (const status of errorStatuses) {
      const label = STATUS_LABELS[status] ?? `Status${status}`;
      guardExports.push(`is${capName}${label}`);
    }
  }

  const content = `// This file is auto-generated by generate-status-unions.ts
// Convenience exports for easy imports

// Re-export all wrapper functions
export {
  ${functionExports}
} from './api-wrappers';

// Re-export type guards
export {
  ${guardExports.join(',\n  ')}
} from './type-guards';

// Re-export types as namespaces
export * as Unions from './status-unions';
export * as Types from './hey-api/types.gen';

// Usage examples:
// import { getModalContent, isGetModalContentSuccess } from '@/generated';
// import type { GetModalContentResult } from '@/generated/status-unions';
`;

  console.log('   ✅ index.ts created');

  return content;
}

function generateTypeGuards(endpoints: EndpointInfo[]): string {
  console.log('\n📝 Generating type guards...\n');

  const guards: string[] = [];

  // ==========================================
  // Generic guards
  // ==========================================

  guards.push(`// ==========================================
// Generic guards
// ==========================================

/** Generic success check for any API result with status field */
export function isSuccess<T extends { status: number }>(
  result: T
): result is Extract<T, { status: 200 }> {
  return result.status === 200;
}

/** Generic error check for any API result with status field */
export function isError<T extends { status: number }>(result: T): boolean {
  return result.status >= 400;
}`);

  console.log('   ✅ Generic guards: isSuccess(), isError()');

  // ==========================================
  // Per-endpoint guards (only multi-status)
  // ==========================================

  for (const endpoint of endpoints) {
    const statuses = Array.from(endpoint.responses.keys()).sort((a, b) => a - b);
    const hasErrors = statuses.some((code) => code >= 400);

    if (!hasErrors) {
      console.log(`   ⏭️  ${endpoint.operationId} — single response, skipping`);
      continue;
    }

    const unionName = `${capitalize(endpoint.operationId)}Result`;
    const capName = capitalize(endpoint.operationId);
    const successStatuses = statuses.filter((code) => code < 400);
    const errorStatuses = statuses.filter((code) => code >= 400);
    const endpointGuards: string[] = [];

    // Section header
    endpointGuards.push(`// ==========================================
// ${endpoint.operationId}
// ==========================================`);

    // isXxxSuccess
    if (successStatuses.length > 0) {
      const successStatus = successStatuses[0];
      endpointGuards.push(`/** Check if response is success (status ${successStatus}) */
export function is${capName}Success(
  result: Unions.${unionName}
): result is Extract<Unions.${unionName}, { status: ${successStatus} }> {
  return result.status === ${successStatus};
}`);
      console.log(`   ✅ is${capName}Success()`);
    }

    // isXxxError (generic error)
    const errorExtractTypes = errorStatuses
      .map((s) => `Extract<Unions.${unionName}, { status: ${s} }>`)
      .join(' | ');

    endpointGuards.push(`/** Check if response is any error (status >= 400) */
export function is${capName}Error(
  result: Unions.${unionName}
): result is ${errorExtractTypes} {
  return result.status >= 400;
}`);
    console.log(`   ✅ is${capName}Error()`);

    // Per-status-code guards
    for (const status of errorStatuses) {
      const label = STATUS_LABELS[status] ?? `Status${status}`;
      endpointGuards.push(`/** Check if response is ${status} ${label} */
export function is${capName}${label}(
  result: Unions.${unionName}
): result is Extract<Unions.${unionName}, { status: ${status} }> {
  return result.status === ${status};
}`);
      console.log(`   ✅ is${capName}${label}()`);
    }

    guards.push(endpointGuards.join('\n\n'));
  }

  const header = `// This file is auto-generated by generate-status-unions.ts
// Do not edit manually - changes will be overwritten

import type * as Unions from './status-unions';

`;

  return header + guards.join('\n\n') + '\n';
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

export function generateStatusUnions(): void {
  console.log('🚀 Gabion: Status Unions Generator\n');
  console.log('================================================\n');

  try {
    console.log(`📂 Reading OpenAPI spec: ${OPENAPI_PATH}\n`);

    if (!existsSync(OPENAPI_PATH)) {
      console.error(`❌ ERROR: OpenAPI file not found: ${OPENAPI_PATH}`);
      console.error('   This file should be created by generate-types.sh');
      console.error('   Run "make types" to generate it\n');
      process.exit(1);
    }

    const openApiContent = readFileSync(OPENAPI_PATH, 'utf-8');
    const spec: OpenAPISpec = JSON.parse(openApiContent);

    const endpoints = parseOpenAPISpec(spec);

    if (endpoints.length === 0) {
      console.error('❌ ERROR: No valid endpoints found in OpenAPI spec\n');
      process.exit(1);
    }

    console.log(`\n📊 Found ${endpoints.length} endpoints\n`);

    const unionsContent = generateUnionTypes(endpoints);
    const wrappersContent = generateWrappers(endpoints);
    const guardsContent = generateTypeGuards(endpoints);
    const indexContent = generateIndex(endpoints);

    console.log('\n💾 Writing generated files...\n');

    writeFileSync(UNIONS_FILE, unionsContent, 'utf-8');
    console.log(`   ✅ ${relative(process.cwd(), UNIONS_FILE)}`);

    writeFileSync(WRAPPERS_FILE, wrappersContent, 'utf-8');
    console.log(`   ✅ ${relative(process.cwd(), WRAPPERS_FILE)}`);

    writeFileSync(GUARDS_FILE, guardsContent, 'utf-8');
    console.log(`   ✅ ${relative(process.cwd(), GUARDS_FILE)}`);

    writeFileSync(INDEX_FILE, indexContent, 'utf-8');
    console.log(`   ✅ ${relative(process.cwd(), INDEX_FILE)}`);

    const withErrors = endpoints.filter((e) =>
      Array.from(e.responses.keys()).some((code) => code >= 400)
    ).length;
    const singleResponse = endpoints.length - withErrors;

    console.log('\n================================================');
    console.log('✅ Generation complete!\n');
    console.log('📊 Summary:');
    console.log(`   - Total endpoints: ${endpoints.length}`);
    console.log(`   - With error handling: ${withErrors}`);
    console.log(`   - Single response: ${singleResponse}`);
    console.log(`   - Generated files: 4`);
    console.log('\n💡 Usage:');
    console.log('   import { getModalContent } from "@/generated";');
    console.log('   import type { GetModalContentResult } from "@/generated/status-unions";\n');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    console.error('\n❌ ERROR:', message);
    console.error('\nStack trace:');
    console.error(stack);
    process.exit(1);
  }
}

