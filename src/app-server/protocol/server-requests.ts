import type {
  ApprovalAction,
  ApprovalActionIntent,
  ApprovalDetailRow,
  McpElicitationAction,
  McpElicitationContentValue,
  PendingApproval,
  PendingApprovalOption,
  PendingMcpElicitation,
  PendingMcpElicitationField,
  PendingMcpElicitationOption,
  PendingUserInput,
} from "../../domain/pending-requests/model";
import type { ServerRequest } from "../../generated/app-server/ServerRequest";
import { pathRelativeToRoot } from "../../shared/path/file-paths";
import { jsonPreview } from "../../shared/text/preview";

type AppServerRequestByMethod<Method extends ServerRequest["method"]> = Extract<ServerRequest, { method: Method }>;

interface AppServerGrantedPermissionProfile {
  network?: unknown;
  fileSystem?: unknown;
}

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
type CommandApprovalRequest = AppServerRequestByMethod<"item/commandExecution/requestApproval">;
type CommandApprovalParams = CommandApprovalRequest["params"];
type CommandApprovalDecision = NonNullable<CommandApprovalParams["availableDecisions"]>[number];
type FileChangeApprovalParams = AppServerRequestByMethod<"item/fileChange/requestApproval">["params"];
type PermissionsApprovalParams = AppServerRequestByMethod<"item/permissions/requestApproval">["params"];

export type AppServerApprovalResponse =
  | { decision: CommandApprovalDecision }
  | { scope: "session" | "turn"; permissions: AppServerGrantedPermissionProfile };

export interface AppServerUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

type AppServerMcpElicitationRequest = AppServerRequestByMethod<"mcpServer/elicitation/request">;
type AppServerMcpElicitationFormParams = Extract<AppServerMcpElicitationRequest["params"], { mode: "form" }>;
type AppServerMcpElicitationSchema = NonNullable<AppServerMcpElicitationFormParams["requestedSchema"]>;
type AppServerMcpElicitationPrimitiveSchema = NonNullable<
  Extract<AppServerMcpElicitationSchema, { properties: unknown }>["properties"][string]
>;

export interface AppServerMcpElicitationResponse {
  action: McpElicitationAction;
  content: unknown;
  _meta: unknown;
}

export function appServerApprovalRequest(request: ServerRequest): PendingApproval | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return commandApprovalRequest(request.id, request.params);
    case "item/fileChange/requestApproval":
      return fileChangeApprovalRequest(request.id, request.params);
    case "item/permissions/requestApproval":
      return permissionsApprovalRequest(request.id, request.params);
    default:
      return null;
  }
}

export function appServerApprovalResponse(approval: PendingApproval, action: ApprovalAction): AppServerApprovalResponse {
  if (isApprovalOptionAction(action)) return action.response as AppServerApprovalResponse;
  return approvalResponseForIntent(approval, action);
}

export function appServerUserInputRequest(request: ServerRequest): PendingUserInput | null {
  if (request.method !== "item/tool/requestUserInput") return null;
  return {
    requestId: request.id,
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
    params: {
      threadId: params.threadId,
      turnId: params.turnId,
      serverName: params.serverName,
      mode: "form",
      message: params.message,
      meta: params._meta,
      fields: mcpElicitationFieldsFromRequestedSchema(params.requestedSchema),
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

function commandApprovalRequest(requestId: PendingApproval["requestId"], params: CommandApprovalParams): PendingApproval {
  const details = commandApprovalDetails(params);
  return {
    requestId,
    kind: "command",
    turnId: params.turnId,
    title: "Command approval",
    summary: approvalSummary(params.reason, params.command, "Command execution requested."),
    resultSummary: approvalResultSummary(params.reason, params.command, "Command execution requested."),
    details,
    responses: decisionResponses(commandDecision),
    actionOptions: commandApprovalActionOptions(params.availableDecisions),
  };
}

function fileChangeApprovalRequest(requestId: PendingApproval["requestId"], params: FileChangeApprovalParams): PendingApproval {
  const reason = params.reason ?? null;
  const grantRoot = params.grantRoot ?? null;
  return {
    requestId,
    kind: "fileChange",
    turnId: params.turnId,
    title: "File change approval",
    summary: approvalSummary(reason, grantRoot ? `grant root: ${grantRoot}` : null, "Allow file changes?"),
    resultSummary: approvalResultSummary(reason, grantRoot ? `grant root: ${grantRoot}` : null, "Allow file changes?"),
    details: grantRoot ? [{ key: "grant root", value: grantRoot }] : [],
    responses: decisionResponses(fileChangeDecision),
    actionOptions: null,
  };
}

function permissionsApprovalRequest(requestId: PendingApproval["requestId"], params: PermissionsApprovalParams): PendingApproval {
  const details: ApprovalDetailRow[] = [];
  addOptional(details, "reason", params.reason);
  addOptional(details, "cwd", params.cwd);
  addOptional(details, "environment", params.environmentId);
  details.push(...permissionRows(params.permissions));
  return {
    requestId,
    kind: "permission",
    turnId: params.turnId,
    title: "Permission approval",
    summary: approvalSummary(params.reason, `cwd: ${params.cwd}`, "Permission change requested."),
    resultSummary: approvalResultSummary(params.reason, `cwd: ${params.cwd}`, "Permission change requested."),
    details,
    responses: {
      accept: { scope: "turn", permissions: grantedPermissions(params.permissions) },
      acceptSession: { scope: "session", permissions: grantedPermissions(params.permissions) },
      decline: { scope: "turn", permissions: {} },
      cancel: { scope: "turn", permissions: {} },
    },
    actionOptions: null,
  };
}

function decisionResponses(decision: (intent: ApprovalActionIntent) => SimpleApprovalDecision): PendingApproval["responses"] {
  return {
    accept: { decision: decision("accept") },
    acceptSession: { decision: decision("accept-session") },
    decline: { decision: decision("decline") },
    cancel: { decision: decision("cancel") },
  };
}

function approvalResponseForIntent(approval: PendingApproval, intent: ApprovalActionIntent): AppServerApprovalResponse {
  if (intent === "accept") return approval.responses.accept as AppServerApprovalResponse;
  if (intent === "accept-session") return approval.responses.acceptSession as AppServerApprovalResponse;
  if (intent === "cancel") return approval.responses.cancel as AppServerApprovalResponse;
  return approval.responses.decline as AppServerApprovalResponse;
}

function isApprovalOptionAction(action: ApprovalAction): action is Extract<ApprovalAction, { kind: "approval-option" }> {
  return typeof action === "object";
}

function commandDecision(intent: ApprovalActionIntent): SimpleApprovalDecision {
  if (intent === "accept") return "accept";
  if (intent === "accept-session") return "acceptForSession";
  if (intent === "cancel") return "cancel";
  return "decline";
}

function fileChangeDecision(intent: ApprovalActionIntent): SimpleApprovalDecision {
  if (intent === "accept") return "accept";
  if (intent === "accept-session") return "acceptForSession";
  if (intent === "cancel") return "cancel";
  return "decline";
}

function grantedPermissions(requested: { network?: unknown; fileSystem?: unknown }): AppServerGrantedPermissionProfile {
  const granted: AppServerGrantedPermissionProfile = {};
  if (requested.network) granted.network = requested.network;
  if (requested.fileSystem) granted.fileSystem = requested.fileSystem;
  return granted;
}

interface CommandAction {
  type: string;
  command?: unknown;
  name?: unknown;
  path?: unknown;
  query?: unknown;
}

interface NetworkApprovalContext {
  host?: unknown;
  protocol?: unknown;
}

function commandApprovalDetails(params: CommandApprovalParams): ApprovalDetailRow[] {
  const rows: ApprovalDetailRow[] = [];
  addOptional(rows, "reason", params.reason);
  addOptional(rows, "command", params.command);
  addOptional(rows, "cwd", params.cwd);
  addOptional(rows, "network", networkApprovalContextLabel(params.networkApprovalContext));
  rows.push(...commandActionRows(params.commandActions, params.cwd));
  rows.push(...prefixedPermissionRows("additional", params.additionalPermissions));
  addOptional(rows, "future command rule", params.proposedExecpolicyAmendment);
  addOptional(rows, "future network rules", networkPolicyAmendmentsLabel(params.proposedNetworkPolicyAmendments));
  return rows;
}

function commandApprovalActionOptions(decisions: CommandApprovalParams["availableDecisions"]): PendingApprovalOption[] | null {
  if (!decisions || decisions.length === 0) return null;
  return decisions.map((decision, index) => {
    const intent = commandDecisionIntent(decision);
    return {
      id: `approval-option:${String(index)}:${commandDecisionKey(decision)}`,
      label: commandDecisionLabel(decision),
      intent,
      action: {
        kind: "approval-option",
        intent,
        response: { decision },
      },
    };
  });
}

function commandDecisionIntent(decision: CommandApprovalDecision): ApprovalActionIntent {
  if (typeof decision === "string") return simpleCommandDecisionIntent(decision);
  if ("acceptWithExecpolicyAmendment" in decision) return "accept-session";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "accept-session" : "decline";
  }
  return "decline";
}

function simpleCommandDecisionIntent(decision: string): ApprovalActionIntent {
  if (decision === "accept") return "accept";
  if (decision === "acceptForSession") return "accept-session";
  if (decision === "cancel") return "cancel";
  return "decline";
}

function commandDecisionLabel(decision: CommandApprovalDecision): string {
  if (typeof decision === "string") return simpleCommandDecisionLabel(decision);
  if ("acceptWithExecpolicyAmendment" in decision) return "Allow rule";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "Allow network rule" : "Deny network rule";
  }
  return "Choose";
}

function simpleCommandDecisionLabel(decision: string): string {
  if (decision === "accept") return "Allow";
  if (decision === "acceptForSession") return "Allow session";
  if (decision === "decline") return "Deny";
  if (decision === "cancel") return "Cancel";
  return "Choose";
}

function commandDecisionKey(decision: CommandApprovalDecision): string {
  if (typeof decision === "string") return decision;
  if ("acceptWithExecpolicyAmendment" in decision) return "acceptWithExecpolicyAmendment";
  if ("applyNetworkPolicyAmendment" in decision) {
    const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
    const host = amendment.host;
    return `applyNetworkPolicyAmendment:${amendment.action}:${typeof host === "string" ? host : ""}`;
  }
  return "unknown";
}

function approvalSummary(reason: unknown, target: unknown, fallback: string): string {
  const lines = [nonEmptyString(reason), nonEmptyString(target)].filter((value): value is string => Boolean(value));
  return (lines.length > 0 ? lines : [fallback]).join("\n");
}

function approvalResultSummary(reason: unknown, target: unknown, fallback: string): string {
  return nonEmptyString(reason) ?? nonEmptyString(target) ?? fallback;
}

function commandActionRows(value: unknown, cwd: string | null | undefined): ApprovalDetailRow[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return [
    {
      key: value.length === 1 ? "action" : "actions",
      value: value
        .map((action) => (isCommandAction(action) ? commandActionLabel(action, cwd) : stringValue(action, "unknown action")))
        .join("\n"),
    },
  ];
}

function commandActionLabel(action: CommandAction, cwd: string | null | undefined): string {
  if (action.type === "read") {
    const path = pathLabel(action.path, cwd);
    return path ? `read ${path}` : `read ${nonEmptyString(action.name) ?? "file"}`;
  }
  if (action.type === "search") {
    const query = nonEmptyString(action.query);
    const path = pathLabel(action.path, cwd);
    if (query && path) return `search "${query}" in ${path}`;
    if (query) return `search "${query}"`;
    if (path) return `search ${path}`;
    return "search";
  }
  if (action.type === "listFiles") {
    return `list files ${pathLabel(action.path, cwd) ?? "workspace"}`;
  }
  return nonEmptyString(action.command) ?? action.type;
}

function isCommandAction(value: unknown): value is CommandAction {
  return value !== null && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

function pathLabel(path: unknown, cwd: string | null | undefined): string | null {
  const value = nonEmptyString(path);
  return value ? pathRelativeToRoot(value, cwd) : null;
}

function networkApprovalContextLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const context = value as NetworkApprovalContext;
  const host = nonEmptyString(context.host);
  if (!host) return null;
  const protocol = nonEmptyString(context.protocol);
  return protocol ? `${protocol}://${host}` : host;
}

function prefixedPermissionRows(prefix: string, permissions: unknown): ApprovalDetailRow[] {
  if (!permissions) return [];
  return permissionRows(permissions).map((row) => ({ ...row, key: `${prefix} ${row.key}` }));
}

function permissionRows(permissions: unknown): ApprovalDetailRow[] {
  const profile = asRecordOrNull(permissions);
  if (!profile) return [];
  const rows: ApprovalDetailRow[] = [];
  const networkEnabled = asRecordOrNull(profile["network"])?.["enabled"];
  if (typeof networkEnabled === "boolean") {
    rows.push({ key: "network", value: networkEnabled ? "enabled" : "disabled" });
  }

  const fileSystem = asRecordOrNull(profile["fileSystem"]);
  if (!fileSystem) return rows;

  const entries = fileSystem["entries"];
  if (Array.isArray(entries) && entries.length > 0) {
    rows.push({
      key: "filesystem",
      value: entries
        .map((entry) => {
          const record = asRecordOrNull(entry);
          return record ? `${fileSystemPathLabel(record["path"])} (${stringValue(record["access"], "unknown")})` : stringValue(entry);
        })
        .join("\n"),
    });
  }
  addOptional(rows, "read", fileSystem["read"]);
  addOptional(rows, "write", fileSystem["write"]);
  addOptional(rows, "glob depth", fileSystem["globScanMaxDepth"]);
  return rows;
}

function fileSystemPathLabel(path: unknown): string {
  const record = asRecordOrNull(path);
  if (!record) return stringValue(path, "unknown");
  if (record["type"] === "path") return stringValue(record["path"], "unknown");
  if (record["type"] === "glob_pattern") return stringValue(record["pattern"], "unknown");

  const special = asRecordOrNull(record["value"]);
  if (!special) return stringValue(path, "unknown");
  if (special["kind"] === "project_roots") {
    const subpath = nonEmptyString(special["subpath"]);
    return subpath ? `project_roots/${subpath}` : "project_roots";
  }
  if (special["kind"] === "unknown") {
    const specialPath = nonEmptyString(special["path"]) ?? "unknown";
    const subpath = nonEmptyString(special["subpath"]);
    return subpath ? `${specialPath}/${subpath}` : specialPath;
  }
  return nonEmptyString(special["kind"]) ?? "unknown";
}

function networkPolicyAmendmentsLabel(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map(networkPolicyAmendmentLabel).join("\n");
}

function networkPolicyAmendmentLabel(value: unknown): string {
  if (!value || typeof value !== "object") return stringValue(value, "rule");
  const amendment = value as { action?: unknown; host?: unknown };
  return `${nonEmptyString(amendment.action) ?? "rule"} ${nonEmptyString(amendment.host) ?? "(unknown host)"}`;
}

function addOptional(rows: ApprovalDetailRow[], key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  rows.push({ key, value: stringValue(value) });
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
    return value.join("\n");
  }
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function mcpElicitationFieldsFromRequestedSchema(schema: unknown): PendingMcpElicitationField[] {
  if (!isMcpElicitationObjectSchema(schema)) return [];
  return mcpElicitationFieldsFromSchema(schema.properties, new Set(schema.required ?? []));
}

function isMcpElicitationObjectSchema(schema: unknown): schema is Extract<AppServerMcpElicitationSchema, { properties: unknown }> {
  return Boolean(schema && typeof schema === "object" && "properties" in schema && typeof schema.properties === "object");
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
