import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import type {
  ApprovalAction,
  CommandApprovalDecision,
  McpElicitationAction,
  McpElicitationContentValue,
  PendingApproval,
  PendingMcpElicitation,
  PendingMcpElicitationField,
  PendingMcpElicitationOption,
  PendingUserInput,
} from "../../domain/pending-requests/model";

type AppServerRequestByMethod<Method extends ServerRequest["method"]> = Extract<ServerRequest, { method: Method }>;

interface AppServerGrantedPermissionProfile {
  network?: unknown;
  fileSystem?: unknown;
}

export type AppServerApprovalResponse =
  | { decision: CommandApprovalDecision }
  | { scope: "session" | "turn"; permissions: AppServerGrantedPermissionProfile };

export interface AppServerUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

type AppServerMcpElicitationRequest = AppServerRequestByMethod<"mcpServer/elicitation/request">;
type AppServerMcpElicitationFormParams = Extract<AppServerMcpElicitationRequest["params"], { mode: "form" }>;
type AppServerMcpElicitationPrimitiveSchema = NonNullable<AppServerMcpElicitationFormParams["requestedSchema"]["properties"][string]>;

export interface AppServerMcpElicitationResponse {
  action: McpElicitationAction;
  content: unknown;
  _meta: unknown;
}

export function appServerApprovalRequest(request: ServerRequest): PendingApproval | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      };
    case "item/fileChange/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: {
          ...request.params,
          reason: request.params.reason ?? null,
          grantRoot: request.params.grantRoot ?? null,
        },
      };
    case "item/permissions/requestApproval":
      return {
        requestId: request.id,
        method: request.method,
        params: request.params,
      };
    default:
      return null;
  }
}

export function appServerApprovalResponse(approval: PendingApproval, action: ApprovalAction): AppServerApprovalResponse {
  if (approval.method === "item/commandExecution/requestApproval") {
    return {
      decision: isCommandDecisionAction(action) ? action.decision : commandDecision(action),
    };
  }

  if (approval.method === "item/fileChange/requestApproval") {
    return {
      decision: fileChangeDecision(action),
    };
  }

  return {
    scope: action === "accept-session" ? "session" : "turn",
    permissions: action === "accept" || action === "accept-session" ? grantedPermissions(approval.params.permissions) : {},
  };
}

export function appServerUserInputRequest(request: ServerRequest): PendingUserInput | null {
  if (request.method !== "item/tool/requestUserInput") return null;
  return {
    requestId: request.id,
    method: request.method,
    params: request.params,
  };
}

export function appServerUserInputResponse(
  questions: readonly { id: string }[],
  answers: Record<string, string>,
): AppServerUserInputResponse {
  return {
    answers: Object.fromEntries(
      questions.map((question) => [
        question.id,
        {
          answers: [answers[question.id] ?? ""],
        },
      ]),
    ),
  };
}

export function appServerMcpElicitationRequest(request: ServerRequest): PendingMcpElicitation | null {
  if (request.method !== "mcpServer/elicitation/request") return null;
  const params = request.params;
  if (params.mode === "url") {
    return {
      requestId: request.id,
      method: request.method,
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
    requestId: request.id,
    method: request.method,
    params: {
      threadId: params.threadId,
      turnId: params.turnId,
      serverName: params.serverName,
      mode: "form",
      message: params.message,
      meta: params._meta,
      fields: mcpElicitationFieldsFromSchema(params.requestedSchema.properties, new Set(params.requestedSchema.required ?? [])),
    },
  };
}

export function appServerMcpElicitationResponse(
  action: McpElicitationAction,
  content: Record<string, McpElicitationContentValue> | null,
): AppServerMcpElicitationResponse {
  return {
    action,
    content: action === "accept" ? toJsonContent(content) : null,
    _meta: null,
  };
}

function isCommandDecisionAction(action: ApprovalAction): action is Extract<ApprovalAction, { kind: "command-decision" }> {
  return typeof action === "object";
}

function commandDecision(action: ApprovalAction): CommandApprovalDecision {
  if (action === "accept") return "accept";
  if (action === "accept-session") return "acceptForSession";
  if (action === "cancel") return "cancel";
  return "decline";
}

function fileChangeDecision(action: ApprovalAction): CommandApprovalDecision {
  if (action === "accept") return "accept";
  if (action === "accept-session") return "acceptForSession";
  if (action === "cancel") return "cancel";
  return "decline";
}

function grantedPermissions(requested: { network?: unknown; fileSystem?: unknown }): AppServerGrantedPermissionProfile {
  const granted: AppServerGrantedPermissionProfile = {};
  if (requested.network) granted.network = requested.network;
  if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
  return granted;
}

function mcpElicitationFieldsFromSchema(
  properties: Record<string, AppServerMcpElicitationPrimitiveSchema | undefined>,
  required: ReadonlySet<string>,
): PendingMcpElicitationField[] {
  return Object.entries(properties).flatMap(([id, schema]) => {
    if (!schema) return [];
    return [mcpElicitationFieldFromSchema(id, schema, required.has(id))];
  });
}

function mcpElicitationFieldFromSchema(
  id: string,
  schema: AppServerMcpElicitationPrimitiveSchema,
  required: boolean,
): PendingMcpElicitationField {
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
  const stringSchema = schema as Extract<AppServerMcpElicitationPrimitiveSchema, { type: "string" }>;
  return {
    ...base,
    type: "string",
    format: "format" in stringSchema ? (stringSchema.format ?? null) : null,
    minLength: "minLength" in stringSchema ? (stringSchema.minLength ?? null) : null,
    maxLength: "maxLength" in stringSchema ? (stringSchema.maxLength ?? null) : null,
    defaultValue: typeof stringSchema.default === "string" ? stringSchema.default : "",
  };
}

function singleSelectOptions(schema: Extract<AppServerMcpElicitationPrimitiveSchema, { type: "string" }>): PendingMcpElicitationOption[] {
  if ("oneOf" in schema) return schema.oneOf.map((option) => ({ value: option.const, label: option.title }));
  if ("enum" in schema) {
    const enumNames = "enumNames" in schema ? schema.enumNames : undefined;
    if (enumNames) return schema.enum.map((value, index) => ({ value, label: enumNames[index] ?? value }));
    return schema.enum.map((value) => ({ value, label: value }));
  }
  return [];
}

function multiSelectOptions(schema: Extract<AppServerMcpElicitationPrimitiveSchema, { type: "array" }>): PendingMcpElicitationOption[] {
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
