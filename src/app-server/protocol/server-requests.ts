import type { RequestId } from "../../generated/app-server/RequestId";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

type AppServerCommandApprovalDecision =
  | SimpleApprovalDecision
  | { acceptWithExecpolicyAmendment: unknown }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: { action: "allow" | "deny"; [key: string]: unknown } } };

type AppServerApprovalAction = "accept" | "accept-session" | "decline" | "cancel" | AppServerCommandApprovalDecisionAction;

interface AppServerCommandApprovalDecisionAction {
  kind: "command-decision";
  decision: AppServerCommandApprovalDecision;
}

type AppServerRequestByMethod<Method extends ServerRequest["method"]> = Extract<ServerRequest, { method: Method }>;
type AppServerRequestParams<Method extends ServerRequest["method"]> = AppServerRequestByMethod<Method>["params"];

type AppServerCommandApprovalParams = AppServerRequestParams<"item/commandExecution/requestApproval">;

type AppServerFileChangeApprovalParams = Omit<AppServerRequestParams<"item/fileChange/requestApproval">, "reason" | "grantRoot"> & {
  reason: string | null;
  grantRoot: string | null;
};

type AppServerPermissionsApprovalParams = AppServerRequestParams<"item/permissions/requestApproval">;

export type AppServerApproval =
  | {
      requestId: RequestId;
      method: "item/commandExecution/requestApproval";
      params: AppServerCommandApprovalParams;
    }
  | {
      requestId: RequestId;
      method: "item/fileChange/requestApproval";
      params: AppServerFileChangeApprovalParams;
    }
  | {
      requestId: RequestId;
      method: "item/permissions/requestApproval";
      params: AppServerPermissionsApprovalParams;
    };

interface AppServerGrantedPermissionProfile {
  network?: unknown;
  fileSystem?: unknown;
}

type AppServerApprovalResponseSource =
  | { method: "item/commandExecution/requestApproval" }
  | { method: "item/fileChange/requestApproval" }
  | { method: "item/permissions/requestApproval"; params: { permissions: { network?: unknown; fileSystem?: unknown } } };

export type AppServerApprovalResponse =
  | { decision: AppServerCommandApprovalDecision }
  | { decision: SimpleApprovalDecision }
  | { scope: "session" | "turn"; permissions: AppServerGrantedPermissionProfile };

type AppServerUserInputParams = AppServerRequestParams<"item/tool/requestUserInput">;

export interface AppServerUserInput {
  requestId: RequestId;
  method: "item/tool/requestUserInput";
  params: AppServerUserInputParams;
}

export interface AppServerUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

type AppServerMcpElicitationAction = "accept" | "decline" | "cancel";
type AppServerMcpElicitationContentValue = string | number | boolean | readonly string[] | null;
type AppServerMcpElicitationRequest = AppServerRequestByMethod<"mcpServer/elicitation/request">;
type AppServerMcpElicitationFormParams = Extract<AppServerMcpElicitationRequest["params"], { mode: "form" }>;
type AppServerMcpElicitationPrimitiveSchema = NonNullable<AppServerMcpElicitationFormParams["requestedSchema"]["properties"][string]>;

interface AppServerMcpElicitationOption {
  value: string;
  label: string;
}

interface AppServerMcpElicitationFieldBase {
  id: string;
  title: string;
  description: string | null;
  required: boolean;
}

type AppServerMcpElicitationField =
  | (AppServerMcpElicitationFieldBase & {
      type: "string";
      format: string | null;
      minLength: number | null;
      maxLength: number | null;
      defaultValue: string;
    })
  | (AppServerMcpElicitationFieldBase & {
      type: "number" | "integer";
      minimum: number | null;
      maximum: number | null;
      defaultValue: number | null;
    })
  | (AppServerMcpElicitationFieldBase & {
      type: "boolean";
      defaultValue: boolean;
    })
  | (AppServerMcpElicitationFieldBase & {
      type: "single-select";
      options: readonly AppServerMcpElicitationOption[];
      defaultValue: string;
    })
  | (AppServerMcpElicitationFieldBase & {
      type: "multi-select";
      options: readonly AppServerMcpElicitationOption[];
      minItems: number | null;
      maxItems: number | null;
      defaultValue: readonly string[];
    });

interface AppServerMcpElicitationNormalizedFormParams {
  threadId: string;
  turnId: string | null;
  serverName: string;
  mode: "form";
  message: string;
  meta: unknown;
  fields: readonly AppServerMcpElicitationField[];
}

interface AppServerMcpElicitationNormalizedUrlParams {
  threadId: string;
  turnId: string | null;
  serverName: string;
  mode: "url";
  message: string;
  meta: unknown;
  url: string;
  elicitationId: string;
}

export interface AppServerMcpElicitation {
  requestId: RequestId;
  method: "mcpServer/elicitation/request";
  params: AppServerMcpElicitationNormalizedFormParams | AppServerMcpElicitationNormalizedUrlParams;
}

export interface AppServerMcpElicitationResponse {
  action: AppServerMcpElicitationAction;
  content: unknown;
  _meta: unknown;
}

export function appServerApprovalRequest(request: ServerRequest): AppServerApproval | null {
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

export function appServerApprovalResponse(
  approval: AppServerApprovalResponseSource,
  action: AppServerApprovalAction,
): AppServerApprovalResponse {
  if (approval.method === "item/commandExecution/requestApproval") {
    return {
      decision: isAppServerCommandDecisionAction(action) ? action.decision : commandDecision(action),
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

export function appServerUserInputRequest(request: ServerRequest): AppServerUserInput | null {
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

export function appServerMcpElicitationRequest(request: ServerRequest): AppServerMcpElicitation | null {
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
  action: AppServerMcpElicitationAction,
  content: Record<string, AppServerMcpElicitationContentValue> | null,
): AppServerMcpElicitationResponse {
  return {
    action,
    content: action === "accept" ? toJsonContent(content) : null,
    _meta: null,
  };
}

function isAppServerCommandDecisionAction(action: AppServerApprovalAction): action is AppServerCommandApprovalDecisionAction {
  return typeof action === "object";
}

function commandDecision(action: AppServerApprovalAction): AppServerCommandApprovalDecision {
  if (action === "accept") return "accept";
  if (action === "accept-session") return "acceptForSession";
  if (action === "cancel") return "cancel";
  return "decline";
}

function fileChangeDecision(action: AppServerApprovalAction): SimpleApprovalDecision {
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
): AppServerMcpElicitationField[] {
  return Object.entries(properties).flatMap(([id, schema]) => {
    if (!schema) return [];
    return [mcpElicitationFieldFromSchema(id, schema, required.has(id))];
  });
}

function mcpElicitationFieldFromSchema(
  id: string,
  schema: AppServerMcpElicitationPrimitiveSchema,
  required: boolean,
): AppServerMcpElicitationField {
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

function singleSelectOptions(schema: Extract<AppServerMcpElicitationPrimitiveSchema, { type: "string" }>): AppServerMcpElicitationOption[] {
  if ("oneOf" in schema) return schema.oneOf.map((option) => ({ value: option.const, label: option.title }));
  if ("enum" in schema) {
    const enumNames = "enumNames" in schema ? schema.enumNames : undefined;
    if (enumNames) return schema.enum.map((value, index) => ({ value, label: enumNames[index] ?? value }));
    return schema.enum.map((value) => ({ value, label: value }));
  }
  return [];
}

function multiSelectOptions(schema: Extract<AppServerMcpElicitationPrimitiveSchema, { type: "array" }>): AppServerMcpElicitationOption[] {
  if ("anyOf" in schema.items) return schema.items.anyOf.map((option) => ({ value: option.const, label: option.title }));
  return schema.items.enum.map((value) => ({ value, label: value }));
}

function bigintToNumberOrNull(value: bigint | number | undefined): number | null {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toJsonContent(content: Record<string, AppServerMcpElicitationContentValue> | null): unknown {
  if (!content) return null;
  return Object.fromEntries(Object.entries(content).map(([key, value]) => [key, toJsonValue(value)]));
}

function toJsonValue(value: AppServerMcpElicitationContentValue): unknown {
  if (isReadonlyStringArray(value)) return [...value];
  return value;
}

function isReadonlyStringArray(value: AppServerMcpElicitationContentValue): value is readonly string[] {
  return Array.isArray(value);
}
