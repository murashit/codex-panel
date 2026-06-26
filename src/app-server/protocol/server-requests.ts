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
  PendingUserInputQuestion,
} from "../../domain/pending-requests/model";
import { pathRelativeToRoot } from "../../shared/path/file-paths";
import { jsonPreview } from "../../shared/text/preview";

interface AppServerGrantedPermissionProfile {
  network?: unknown;
  fileSystem?: unknown;
}

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
type CommandApprovalDecision =
  | SimpleApprovalDecision
  | { acceptWithExecpolicyAmendment: unknown }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: { action?: unknown; host?: unknown } } };

type AppServerRequest = {
  method: string;
  id: PendingApproval["requestId"];
  params: unknown;
};

interface CommandApprovalParams {
  command?: unknown;
  cwd?: unknown;
  turnId?: unknown;
  reason?: unknown;
  networkApprovalContext?: unknown;
  commandActions?: unknown;
  additionalPermissions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown;
  availableDecisions?: unknown;
}

interface FileChangeApprovalParams {
  turnId?: unknown;
  reason?: unknown;
  grantRoot?: unknown;
}

interface PermissionsApprovalParams {
  cwd?: unknown;
  turnId?: unknown;
  reason?: unknown;
  environmentId?: unknown;
  permissions?: unknown;
}

type AppServerMcpElicitationPrimitiveSchema =
  | {
      type: "boolean";
      title?: unknown;
      description?: unknown;
      default?: unknown;
    }
  | {
      type: "number" | "integer";
      title?: unknown;
      description?: unknown;
      default?: unknown;
      minimum?: unknown;
      maximum?: unknown;
    }
  | {
      type: "array";
      title?: unknown;
      description?: unknown;
      default?: unknown;
      minItems?: unknown;
      maxItems?: unknown;
      items?: unknown;
    }
  | {
      type: "string";
      title?: unknown;
      description?: unknown;
      default?: unknown;
      format?: unknown;
      minLength?: unknown;
      maxLength?: unknown;
      oneOf?: unknown;
      enum?: unknown;
      enumNames?: unknown;
    };

interface NormalizedMcpElicitationParams {
  threadId: string;
  turnId: string | null;
  serverName: string;
  mode: "form" | "url";
  message: string;
  meta: unknown;
  requestedSchema?: unknown;
  url: string;
  elicitationId: string;
}

export type AppServerApprovalResponse =
  | { decision: CommandApprovalDecision }
  | { scope: "session" | "turn"; permissions: AppServerGrantedPermissionProfile };

export interface AppServerUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

export interface AppServerMcpElicitationResponse {
  action: McpElicitationAction;
  content: unknown;
  _meta: unknown;
}

export function appServerApprovalRequest(request: AppServerRequest): PendingApproval | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return commandApprovalRequest(request.id, asRecordOrEmpty(request.params));
    case "item/fileChange/requestApproval":
      return fileChangeApprovalRequest(request.id, asRecordOrEmpty(request.params));
    case "item/permissions/requestApproval":
      return permissionsApprovalRequest(request.id, asRecordOrEmpty(request.params));
    default:
      return null;
  }
}

export function appServerApprovalResponse(approval: PendingApproval, action: ApprovalAction): AppServerApprovalResponse {
  if (isApprovalOptionAction(action)) return action.response as AppServerApprovalResponse;
  return approvalResponseForIntent(approval, action);
}

export function appServerUserInputRequest(request: AppServerRequest): PendingUserInput | null {
  if (request.method !== "item/tool/requestUserInput") return null;
  const params = pendingUserInputParams(request.params);
  if (!params) return null;
  return {
    requestId: request.id,
    params,
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

export function appServerMcpElicitationRequest(request: AppServerRequest): PendingMcpElicitation | null {
  if (request.method !== "mcpServer/elicitation/request") return null;
  const params = mcpElicitationParams(request.params);
  if (!params) return null;
  if (params.mode === "url") {
    return {
      requestId: request.id,
      params: {
        threadId: params.threadId,
        turnId: params.turnId,
        serverName: params.serverName,
        mode: "url",
        message: params.message,
        meta: params.meta,
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
      meta: params.meta,
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
    turnId: nullableString(params.turnId),
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
  const grantRoot = nonEmptyString(params.grantRoot);
  return {
    requestId,
    kind: "fileChange",
    turnId: nullableString(params.turnId),
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
  const cwd = stringValue(params.cwd);
  const cwdSummary = cwd ? `cwd: ${cwd}` : null;
  addOptional(details, "reason", params.reason);
  addOptional(details, "cwd", params.cwd);
  addOptional(details, "environment", params.environmentId);
  details.push(...permissionRows(params.permissions));
  return {
    requestId,
    kind: "permission",
    turnId: nullableString(params.turnId),
    title: "Permission approval",
    summary: approvalSummary(params.reason, cwdSummary, "Permission change requested."),
    resultSummary: approvalResultSummary(params.reason, cwdSummary, "Permission change requested."),
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

function grantedPermissions(requested: unknown): AppServerGrantedPermissionProfile {
  const profile = asRecordOrNull(requested);
  const granted: AppServerGrantedPermissionProfile = {};
  if (profile?.["network"]) granted.network = profile["network"];
  if (profile?.["fileSystem"]) granted.fileSystem = profile["fileSystem"];
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
  const cwd = nullableString(params.cwd);
  addOptional(rows, "reason", params.reason);
  addOptional(rows, "command", params.command);
  addOptional(rows, "cwd", params.cwd);
  addOptional(rows, "network", networkApprovalContextLabel(params.networkApprovalContext));
  rows.push(...commandActionRows(params.commandActions, cwd));
  rows.push(...prefixedPermissionRows("additional", params.additionalPermissions));
  addOptional(rows, "future command rule", params.proposedExecpolicyAmendment);
  addOptional(rows, "future network rules", networkPolicyAmendmentsLabel(params.proposedNetworkPolicyAmendments));
  return rows;
}

function commandApprovalActionOptions(decisions: CommandApprovalParams["availableDecisions"]): PendingApprovalOption[] | null {
  const availableDecisions = commandApprovalDecisions(decisions);
  if (availableDecisions.length === 0) return null;
  return availableDecisions.map((decision, index) => {
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

function commandApprovalDecisions(value: unknown): CommandApprovalDecision[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isCommandApprovalDecision);
}

function isCommandApprovalDecision(value: unknown): value is CommandApprovalDecision {
  if (typeof value === "string") return true;
  const decision = asRecordOrNull(value);
  if (!decision) return false;
  if ("acceptWithExecpolicyAmendment" in decision) return true;
  const networkDecision = asRecordOrNull(decision["applyNetworkPolicyAmendment"]);
  return Boolean(asRecordOrNull(networkDecision?.["network_policy_amendment"]));
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
    return `applyNetworkPolicyAmendment:${stringValue(amendment.action)}:${typeof host === "string" ? host : ""}`;
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

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asRecordOrEmpty(value: unknown): Record<string, unknown> {
  return asRecordOrNull(value) ?? {};
}

function pendingUserInputParams(value: unknown): PendingUserInput["params"] | null {
  const params = asRecordOrNull(value);
  const questions = params?.["questions"];
  if (!params || !Array.isArray(questions)) return null;
  return {
    threadId: stringValue(params["threadId"]),
    turnId: stringValue(params["turnId"]),
    itemId: stringValue(params["itemId"]),
    questions: questions.map(pendingUserInputQuestion),
    autoResolutionMs: numberOrNull(params["autoResolutionMs"]),
  };
}

function pendingUserInputQuestion(value: unknown): PendingUserInputQuestion {
  const question = asRecordOrEmpty(value);
  const options = question["options"];
  return {
    id: stringValue(question["id"]),
    header: stringValue(question["header"]),
    question: stringValue(question["question"]),
    isOther: question["isOther"] === true,
    isSecret: question["isSecret"] === true,
    options: Array.isArray(options)
      ? options.map((option) => {
          const record = asRecordOrEmpty(option);
          return { label: stringValue(record["label"]), description: stringValue(record["description"]) };
        })
      : null,
  };
}

function mcpElicitationParams(value: unknown): NormalizedMcpElicitationParams | null {
  const params = asRecordOrNull(value);
  if (!params) return null;
  const mode = params["mode"];
  if (mode !== "form" && mode !== "url") return null;
  return {
    threadId: stringValue(params["threadId"]),
    turnId: nullableString(params["turnId"]),
    serverName: stringValue(params["serverName"]),
    mode,
    message: stringValue(params["message"]),
    meta: params["_meta"] ?? null,
    requestedSchema: params["requestedSchema"],
    url: stringValue(params["url"]),
    elicitationId: stringValue(params["elicitationId"]),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mcpElicitationFieldsFromRequestedSchema(schema: unknown): PendingMcpElicitationField[] {
  const record = asRecordOrNull(schema);
  const properties = asRecordOrNull(record?.["properties"]);
  if (!properties) return [];
  const required = new Set(
    Array.isArray(record?.["required"]) ? record["required"].filter((item): item is string => typeof item === "string") : [],
  );
  return Object.entries(properties).flatMap(([id, fieldSchema]) => {
    if (!isMcpElicitationPrimitiveSchema(fieldSchema)) return [];
    return [mcpElicitationFieldFromSchema(id, fieldSchema, required.has(id))];
  });
}

function isMcpElicitationPrimitiveSchema(schema: unknown): schema is AppServerMcpElicitationPrimitiveSchema {
  const record = asRecordOrNull(schema);
  if (!record) return false;
  const type = record["type"];
  return type === "boolean" || type === "number" || type === "integer" || type === "array" || type === "string";
}

function mcpElicitationFieldFromSchema(
  id: string,
  schema: AppServerMcpElicitationPrimitiveSchema,
  required: boolean,
): PendingMcpElicitationField {
  const base = {
    id,
    title: nonEmptyString(schema.title) ?? id,
    description: nonEmptyString(schema.description),
    required,
  };
  switch (schema.type) {
    case "boolean":
      return { ...base, type: "boolean", defaultValue: schema.default === true };
    case "number":
    case "integer":
      return {
        ...base,
        type: schema.type,
        minimum: numberOrNull(schema.minimum),
        maximum: numberOrNull(schema.maximum),
        defaultValue: numberOrNull(schema.default),
      };
    case "array":
      return {
        ...base,
        type: "multi-select",
        options: multiSelectOptions(schema),
        minItems: bigintToNumberOrNull(schema.minItems),
        maxItems: bigintToNumberOrNull(schema.maxItems),
        defaultValue: stringArrayOrEmpty(schema.default),
      };
    case "string": {
      const options = singleSelectOptions(schema);
      if (options.length > 0) {
        return {
          ...base,
          type: "single-select",
          options,
          defaultValue: typeof schema.default === "string" ? schema.default : (options[0]?.value ?? ""),
        };
      }
      return {
        ...base,
        type: "string",
        format: nullableString(schema.format),
        minLength: numberOrNull(schema.minLength),
        maxLength: numberOrNull(schema.maxLength),
        defaultValue: typeof schema.default === "string" ? schema.default : "",
      };
    }
  }
}

function singleSelectOptions(schema: Extract<AppServerMcpElicitationPrimitiveSchema, { type: "string" }>): PendingMcpElicitationOption[] {
  if (Array.isArray(schema.oneOf)) {
    const options = schema.oneOf.flatMap((option) => {
      const selected = selectOption(option);
      return selected ? [selected] : [];
    });
    if (options.length > 0) return options;
  }
  return enumOptions(schema.enum, schema.enumNames);
}

function multiSelectOptions(schema: Extract<AppServerMcpElicitationPrimitiveSchema, { type: "array" }>): PendingMcpElicitationOption[] {
  const items = asRecordOrNull(schema.items);
  const anyOf = items?.["anyOf"];
  if (Array.isArray(anyOf)) {
    const options = anyOf.flatMap((option) => {
      const selected = selectOption(option);
      return selected ? [selected] : [];
    });
    if (options.length > 0) return options;
  }
  return enumOptions(items?.["enum"], null);
}

function stringArrayOrEmpty(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  if (!value.every((item) => typeof item === "string")) return [];
  return value;
}

function enumOptions(values: unknown, labels: unknown): PendingMcpElicitationOption[] {
  if (!Array.isArray(values)) return [];
  const labelValues = Array.isArray(labels) ? labels : [];
  return values.flatMap((value, index) => {
    if (typeof value !== "string") return [];
    return [{ value, label: nonEmptyString(labelValues[index]) ?? value }];
  });
}

function selectOption(value: unknown): PendingMcpElicitationOption | null {
  const record = asRecordOrNull(value);
  const optionValue = nullableString(record?.["const"]);
  if (optionValue === null) return null;
  return { value: optionValue, label: nonEmptyString(record?.["title"]) ?? optionValue };
}

function bigintToNumberOrNull(value: unknown): number | null {
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
