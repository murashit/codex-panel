import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type {
  McpElicitationAction,
  McpElicitationContentValue,
  PendingMcpElicitation,
  PendingMcpElicitationField,
  PendingMcpElicitationOption,
  PendingRequestId,
} from "../../domain/pending-requests/model";

type AppServerMcpElicitationRequest = Extract<ServerRequest, { method: "mcpServer/elicitation/request" }>;
type AppServerMcpElicitationFormParams = Extract<AppServerMcpElicitationRequest["params"], { mode: "form" }>;
type McpElicitationPrimitiveSchema = NonNullable<AppServerMcpElicitationFormParams["requestedSchema"]["properties"][string]>;

interface McpServerElicitationRequestResponse {
  action: McpElicitationAction;
  content: unknown;
  _meta: unknown;
}

interface McpElicitationRequestLike {
  id: PendingRequestId;
  method: string;
  params: unknown;
}

export function toPendingMcpElicitation(request: McpElicitationRequestLike): PendingMcpElicitation | null {
  if (request.method !== "mcpServer/elicitation/request") return null;
  const mcpRequest = request as AppServerMcpElicitationRequest;
  const params = mcpRequest.params;
  if (params.mode === "url") {
    return {
      requestId: mcpRequest.id,
      method: mcpRequest.method,
      params: {
        threadId: params.threadId,
        turnId: params.turnId,
        serverName: params.serverName,
        mode: "url",
        message: params.message,
        meta: params._meta,
        url: params.url,
        elicitationId: params.elicitationId,
      },
    };
  }
  return {
    requestId: mcpRequest.id,
    method: mcpRequest.method,
    params: {
      threadId: params.threadId,
      turnId: params.turnId,
      serverName: params.serverName,
      mode: "form",
      message: params.message,
      meta: params._meta,
      fields: fieldsFromSchema(params.requestedSchema.properties, new Set(params.requestedSchema.required ?? [])),
    },
  };
}

export function mcpElicitationResponse(
  action: McpElicitationAction,
  content: Record<string, McpElicitationContentValue> | null,
): McpServerElicitationRequestResponse {
  return {
    action,
    content: action === "accept" ? toJsonContent(content) : null,
    _meta: null,
  };
}

function fieldsFromSchema(
  properties: Record<string, McpElicitationPrimitiveSchema | undefined>,
  required: ReadonlySet<string>,
): PendingMcpElicitationField[] {
  return Object.entries(properties).flatMap(([id, schema]) => {
    if (!schema) return [];
    return [fieldFromSchema(id, schema, required.has(id))];
  });
}

function fieldFromSchema(id: string, schema: McpElicitationPrimitiveSchema, required: boolean): PendingMcpElicitationField {
  const base = {
    id,
    title: schema.title ?? id,
    description: schema.description ?? null,
    required,
  };
  if (schema.type === "boolean") {
    return { ...base, type: "boolean", defaultValue: schema.default ?? false };
  }
  if (schema.type === "number" || schema.type === "integer") {
    return {
      ...base,
      type: schema.type,
      minimum: schema.minimum ?? null,
      maximum: schema.maximum ?? null,
      defaultValue: schema.default ?? null,
    };
  }
  if (schema.type === "array") {
    return {
      ...base,
      type: "multi-select",
      options: multiSelectOptions(schema),
      minItems: bigintToNumberOrNull(schema.minItems),
      maxItems: bigintToNumberOrNull(schema.maxItems),
      defaultValue: schema.default ?? [],
    };
  }
  if ("oneOf" in schema || "enum" in schema) {
    const options = singleSelectOptions(schema);
    return {
      ...base,
      type: "single-select",
      options,
      defaultValue: schema.default ?? options[0]?.value ?? "",
    };
  }
  const stringSchema = schema as Extract<McpElicitationPrimitiveSchema, { type: "string" }>;
  return {
    ...base,
    type: "string",
    format: "format" in stringSchema ? (stringSchema.format ?? null) : null,
    minLength: "minLength" in stringSchema ? (stringSchema.minLength ?? null) : null,
    maxLength: "maxLength" in stringSchema ? (stringSchema.maxLength ?? null) : null,
    defaultValue: typeof stringSchema.default === "string" ? stringSchema.default : "",
  };
}

function singleSelectOptions(schema: Extract<McpElicitationPrimitiveSchema, { type: "string" }>): PendingMcpElicitationOption[] {
  if ("oneOf" in schema) return schema.oneOf.map((option) => ({ value: option.const, label: option.title }));
  if ("enum" in schema) {
    const enumNames = "enumNames" in schema ? schema.enumNames : undefined;
    if (enumNames) return schema.enum.map((value, index) => ({ value, label: enumNames[index] ?? value }));
    return schema.enum.map((value) => ({ value, label: value }));
  }
  return [];
}

function multiSelectOptions(schema: Extract<McpElicitationPrimitiveSchema, { type: "array" }>): PendingMcpElicitationOption[] {
  if ("anyOf" in schema.items) return schema.items.anyOf.map((option) => ({ value: option.const, label: option.title }));
  return schema.items.enum.map((value) => ({ value, label: value }));
}

function bigintToNumberOrNull(value: bigint | number | undefined): number | null {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toJsonContent(content: Record<string, McpElicitationContentValue> | null): unknown {
  if (!content) return null;
  return Object.fromEntries(Object.entries(content).map(([key, value]) => [key, toJsonValue(value)]));
}

function toJsonValue(value: McpElicitationContentValue): unknown {
  if (isReadonlyStringArray(value)) return [...value];
  return value;
}

function isReadonlyStringArray(value: McpElicitationContentValue): value is readonly string[] {
  return Array.isArray(value);
}
