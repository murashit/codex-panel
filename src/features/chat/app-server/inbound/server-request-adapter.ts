import type { ServerRequest } from "../../../../app-server/connection/rpc-messages";
import { pathRelativeToRoot } from "../../../../domain/files/paths";
import { definedProp } from "../../../../domain/objects/optional-properties";
import type { CommandExecutionRequestApprovalResponse } from "../../../../generated/app-server/v2/CommandExecutionRequestApprovalResponse";
import type { FileChangeRequestApprovalResponse } from "../../../../generated/app-server/v2/FileChangeRequestApprovalResponse";
import type { GrantedPermissionProfile } from "../../../../generated/app-server/v2/GrantedPermissionProfile";
import type { McpServerElicitationRequestResponse } from "../../../../generated/app-server/v2/McpServerElicitationRequestResponse";
import type { PermissionsRequestApprovalResponse } from "../../../../generated/app-server/v2/PermissionsRequestApprovalResponse";
import type { ToolRequestUserInputResponse } from "../../../../generated/app-server/v2/ToolRequestUserInputResponse";
import type {
  ApprovalAction,
  ApprovalActionIntent,
  ApprovalDetailRow,
  McpElicitationAction,
  McpElicitationContentValue,
  PendingApproval,
  PendingCommandApprovalOption,
  PendingMcpElicitation,
  PendingMcpElicitationField,
  PendingMcpElicitationOption,
  PendingUserInput,
  PendingUserInputQuestion,
} from "../../domain/pending-requests/model";
import { addOptional, stringValue } from "../display-values";
import { permissionRows } from "../mappers/thread-stream/permission-rows";
import { asRecordOrNull, nonEmptyString, nullableString } from "../value-readers";

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
type CommandApprovalDecision = CommandExecutionRequestApprovalResponse["decision"];

type AppServerRequest = ServerRequest;
type CommandApprovalRequest = Extract<AppServerRequest, { method: "item/commandExecution/requestApproval" }>;
type FileChangeApprovalRequest = Extract<AppServerRequest, { method: "item/fileChange/requestApproval" }>;
type PermissionsApprovalRequest = Extract<AppServerRequest, { method: "item/permissions/requestApproval" }>;
export type ApprovalRequest = CommandApprovalRequest | FileChangeApprovalRequest | PermissionsApprovalRequest;
type UserInputRequest = Extract<AppServerRequest, { method: "item/tool/requestUserInput" }>;
type McpElicitationRequest = Extract<AppServerRequest, { method: "mcpServer/elicitation/request" }>;

type CommandApprovalParams = CommandApprovalRequest["params"];
type FileChangeApprovalParams = FileChangeApprovalRequest["params"];
type PermissionsApprovalParams = PermissionsApprovalRequest["params"];
type UserInputParams = UserInputRequest["params"];
type UserInputQuestion = UserInputParams["questions"][number];
type McpElicitationParams = McpElicitationRequest["params"];

interface NormalizedMcpElicitationParamsBase {
  turnId: string | null;
  serverName: string;
  message: string;
}

type NormalizedMcpElicitationParams =
  | (NormalizedMcpElicitationParamsBase & { mode: "form"; requestedSchema: unknown })
  | (NormalizedMcpElicitationParamsBase & { mode: "url"; url: string });

export type AppServerApprovalResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | PermissionsRequestApprovalResponse;

export function appServerApprovalRequest(request: AppServerRequest): PendingApproval | null {
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

export function appServerApprovalResponse(request: ApprovalRequest, action: ApprovalAction): AppServerApprovalResponse {
  const intent = typeof action === "object" ? action.intent : action;
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      if (typeof action !== "object") throw new Error("Command approval requires an offered option.");
      const selected = commandApprovalDecisionForOption(request.params.availableDecisions, action.optionId);
      if (isHumanCommandApproval(request) && !isOneTimeCommandDecision(selected))
        throw new Error("Command approval requires a one-time decision.");
      if (selected === undefined) throw new Error(`Unknown command approval option: ${action.optionId}`);
      return { decision: selected } satisfies CommandExecutionRequestApprovalResponse;
    }
    case "item/fileChange/requestApproval":
      return { decision: simpleApprovalDecision(intent) } satisfies FileChangeRequestApprovalResponse;
    case "item/permissions/requestApproval":
      return {
        scope: intent === "accept-session" ? "session" : "turn",
        permissions: intent === "accept" || intent === "accept-session" ? grantedPermissions(request.params.permissions) : {},
      } satisfies PermissionsRequestApprovalResponse;
  }
}

export function isHumanCommandApproval(request: ServerRequest): boolean {
  return request.method === "item/commandExecution/requestApproval" && request.params.kind === "humanCommand";
}

function isOneTimeCommandDecision(decision: unknown): boolean {
  return decision === "accept" || decision === "decline" || decision === "cancel";
}

export function isApprovalServerRequest(request: ServerRequest): request is ApprovalRequest {
  return (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval" ||
    request.method === "item/permissions/requestApproval"
  );
}

export function appServerUserInputRequest(request: AppServerRequest): PendingUserInput | null {
  if (request.method !== "item/tool/requestUserInput") return null;
  const params = pendingUserInputParams(request.params);
  if (!params) return null;
  return {
    requestId: request.id,
    params,
    autoResolutionAtMs: null,
  };
}

export function appServerUserInputResponse(
  questions: readonly { id: string }[],
  answers: Record<string, string>,
): ToolRequestUserInputResponse {
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
  const params = normalizeMcpElicitationParams(request.params);
  if (!params) return null;
  if (params.mode === "url") {
    return {
      requestId: request.id,
      params: {
        turnId: params.turnId,
        serverName: params.serverName,
        mode: "url",
        message: params.message,
        url: params.url,
      },
    };
  }
  const fields = mcpElicitationFieldsFromRequestedSchema(params.requestedSchema);
  if (!fields) return null;
  return {
    requestId: request.id,
    params: {
      turnId: params.turnId,
      serverName: params.serverName,
      mode: "form",
      message: params.message,
      fields,
    },
  };
}

export function appServerMcpElicitationResponse(
  action: McpElicitationAction,
  content: Record<string, McpElicitationContentValue> | null,
): McpServerElicitationRequestResponse {
  return {
    action,
    content: action === "accept" ? toJsonContent(content) : null,
    _meta: null,
  };
}

function commandApprovalRequest(requestId: PendingApproval["requestId"], params: CommandApprovalParams): PendingApproval | null {
  const decisions = commandApprovalDecisions(params.availableDecisions);
  if (!decisions) return null;
  const humanRequired = params.kind === "humanCommand";
  if (humanRequired && !decisions.every(isOneTimeCommandDecision)) return null;
  const details = commandApprovalDetails(params);
  const isWriteStdin = params.kind === "writeStdin";
  const fallback = isWriteStdin ? "Terminal input requested." : "Command execution requested.";
  return {
    requestId,
    threadId: params.threadId,
    kind: humanRequired ? "humanCommand" : "command",
    turnId: nullableString(params.turnId),
    title: isWriteStdin ? "Terminal input approval" : "Command approval",
    summary: approvalSummary(params.reason, params.command, fallback),
    resultSummary: approvalResultSummary(params.reason, params.command, fallback),
    details,
    actionOptions: commandApprovalActionOptions(decisions, humanRequired),
  };
}

function fileChangeApprovalRequest(requestId: PendingApproval["requestId"], params: FileChangeApprovalParams): PendingApproval {
  const reason = params.reason ?? null;
  const grantRoot = nonEmptyString(params.grantRoot);
  return {
    requestId,
    threadId: params.threadId,
    kind: "fileChange",
    turnId: nullableString(params.turnId),
    title: "File change approval",
    summary: approvalSummary(reason, grantRoot ? `grant root: ${grantRoot}` : null, "Allow file changes?"),
    resultSummary: approvalResultSummary(reason, grantRoot ? `grant root: ${grantRoot}` : null, "Allow file changes?"),
    details: grantRoot ? [{ key: "grant root", value: grantRoot }] : [],
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
    threadId: params.threadId,
    kind: "permission",
    turnId: nullableString(params.turnId),
    title: "Permission approval",
    summary: approvalSummary(params.reason, cwdSummary, "Permission change requested."),
    resultSummary: approvalResultSummary(params.reason, cwdSummary, "Permission change requested."),
    details,
    actionOptions: null,
  };
}

function simpleApprovalDecision(intent: ApprovalActionIntent): SimpleApprovalDecision {
  if (intent === "accept") return "accept";
  if (intent === "accept-session") return "acceptForSession";
  if (intent === "cancel") return "cancel";
  return "decline";
}

function grantedPermissions(requested: PermissionsApprovalParams["permissions"] | null | undefined): GrantedPermissionProfile {
  const granted: GrantedPermissionProfile = {};
  if (requested?.network) granted.network = requested.network;
  if (requested?.fileSystem) granted.fileSystem = requested.fileSystem;
  return granted;
}

interface CommandAction {
  type: string;
  command?: unknown;
  name?: unknown;
  path?: unknown;
  query?: unknown;
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

function commandApprovalActionOptions(
  decisions: readonly [CommandApprovalDecision, ...CommandApprovalDecision[]],
  humanRequired: boolean,
): readonly [PendingCommandApprovalOption, ...PendingCommandApprovalOption[]] {
  const [first, ...rest] = decisions;
  return [
    commandApprovalActionOption(first, 0, humanRequired),
    ...rest.map((decision, index) => commandApprovalActionOption(decision, index + 1, humanRequired)),
  ];
}

function commandApprovalActionOption(
  decision: CommandApprovalDecision,
  index: number,
  humanRequired: boolean,
): PendingCommandApprovalOption {
  const id = commandApprovalOptionId(decision, index);
  return {
    id,
    label: humanRequired && decision === "accept" ? "Allow once" : commandDecisionLabel(decision),
    action: { kind: "approval-option", optionId: id, intent: commandDecisionIntent(decision) },
  };
}

function commandApprovalDecisionForOption(
  decisions: CommandApprovalParams["availableDecisions"],
  optionId: string,
): CommandApprovalDecision | undefined {
  return commandApprovalDecisions(decisions)?.find((decision, index) => commandApprovalOptionId(decision, index) === optionId);
}

function commandApprovalOptionId(decision: CommandApprovalDecision, index: number): string {
  return `approval-option:${String(index)}:${commandDecisionKey(decision)}`;
}

function commandApprovalDecisions(value: unknown): readonly [CommandApprovalDecision, ...CommandApprovalDecision[]] | null {
  // The supported app-server supplies a nonempty list; a fallback would offer decisions it did not send.
  if (!Array.isArray(value)) return null;
  const candidates: unknown[] = value;
  const first = candidates[0];
  const rest = candidates.slice(1);
  if (!isCommandApprovalDecision(first) || !rest.every(isCommandApprovalDecision)) return null;
  return [first, ...rest];
}

function isCommandApprovalDecision(value: unknown): value is CommandApprovalDecision {
  if (typeof value === "string") {
    return value === "accept" || value === "acceptForSession" || value === "decline" || value === "cancel";
  }
  const decision = asRecordOrNull(value);
  if (!decision || Object.keys(decision).length !== 1) return false;
  const execpolicyDecision = asRecordOrNull(decision["acceptWithExecpolicyAmendment"]);
  if (execpolicyDecision) {
    const amendment = execpolicyDecision["execpolicy_amendment"];
    return Array.isArray(amendment) && amendment.every((part) => typeof part === "string");
  }
  const networkDecision = asRecordOrNull(decision["applyNetworkPolicyAmendment"]);
  const amendment = asRecordOrNull(networkDecision?.["network_policy_amendment"]);
  return typeof amendment?.["host"] === "string" && (amendment["action"] === "allow" || amendment["action"] === "deny");
}

function commandDecisionIntent(decision: CommandApprovalDecision): ApprovalActionIntent {
  if (typeof decision === "string") return simpleCommandDecisionIntent(decision);
  if ("acceptWithExecpolicyAmendment" in decision) return "accept-rule";
  return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "accept-rule" : "decline-rule";
}

function simpleCommandDecisionIntent(decision: SimpleApprovalDecision): ApprovalActionIntent {
  if (decision === "accept") return "accept";
  if (decision === "acceptForSession") return "accept-session";
  if (decision === "cancel") return "cancel";
  return "decline";
}

function commandDecisionLabel(decision: CommandApprovalDecision): string {
  if (typeof decision === "string") return simpleCommandDecisionLabel(decision);
  if ("acceptWithExecpolicyAmendment" in decision) return "Allow rule";
  return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "Allow network rule" : "Deny network rule";
}

function simpleCommandDecisionLabel(decision: SimpleApprovalDecision): string {
  if (decision === "accept") return "Allow";
  if (decision === "acceptForSession") return "Allow session";
  if (decision === "decline") return "Deny";
  return "Cancel";
}

function commandDecisionKey(decision: CommandApprovalDecision): string {
  if (typeof decision === "string") return decision;
  if ("acceptWithExecpolicyAmendment" in decision) return "acceptWithExecpolicyAmendment";
  const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
  return `applyNetworkPolicyAmendment:${amendment.action}:${amendment.host}`;
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
  return value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";
}

function pathLabel(path: unknown, cwd: string | null | undefined): string | null {
  const value = nonEmptyString(path);
  return value ? pathRelativeToRoot(value, cwd) : null;
}

function networkApprovalContextLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("host" in value)) return null;
  const host = nonEmptyString(value.host);
  if (!host) return null;
  const protocol = "protocol" in value ? nonEmptyString(value.protocol) : null;
  return protocol ? `${protocol}://${host}` : host;
}

function prefixedPermissionRows(prefix: string, permissions: unknown): ApprovalDetailRow[] {
  if (!permissions) return [];
  return permissionRows(permissions).map((row) => ({ ...row, key: `${prefix} ${row.key}` }));
}

function networkPolicyAmendmentsLabel(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map(networkPolicyAmendmentLabel).join("\n");
}

function networkPolicyAmendmentLabel(value: unknown): string {
  if (!value || typeof value !== "object") return stringValue(value, "rule");
  const action = "action" in value ? nonEmptyString(value.action) : null;
  const host = "host" in value ? nonEmptyString(value.host) : null;
  return `${action ?? "rule"} ${host ?? "(unknown host)"}`;
}

function pendingUserInputParams(params: UserInputParams): PendingUserInput["params"] | null {
  const questions: unknown = params.questions;
  if (!Array.isArray(questions)) return null;
  return {
    turnId: stringValue(params.turnId),
    questions: questions.map(pendingUserInputQuestion),
    isBlocking: params.isBlocking,
  };
}

function pendingUserInputQuestion(question: UserInputQuestion): PendingUserInputQuestion {
  const options: unknown = question.options;
  return {
    id: stringValue(question.id),
    header: stringValue(question.header),
    question: stringValue(question.question),
    isOther: question.isOther,
    isSecret: question.isSecret,
    options: Array.isArray(options)
      ? options.map((option) => {
          const record = asRecordOrNull(option) ?? {};
          return { label: stringValue(record["label"]), description: stringValue(record["description"]) };
        })
      : null,
  };
}

function normalizeMcpElicitationParams(params: McpElicitationParams): NormalizedMcpElicitationParams | null {
  switch (params.mode) {
    case "openai/userVerification":
      return null;
    case "form":
    case "openai/form":
    case "openaiForm":
      return {
        turnId: nullableString(params.turnId),
        serverName: stringValue(params.serverName),
        mode: "form",
        message: stringValue(params.message),
        requestedSchema: params.requestedSchema,
      };
    case "url":
      return {
        turnId: nullableString(params.turnId),
        serverName: stringValue(params.serverName),
        mode: "url",
        message: stringValue(params.message),
        url: stringValue(params.url),
      };
  }
}

function mcpElicitationFieldsFromRequestedSchema(schema: unknown): PendingMcpElicitationField[] | null {
  const record = asRecordOrNull(schema);
  const properties = asRecordOrNull(record?.["properties"]);
  if (record?.["type"] !== "object" || !properties) return null;
  const required = new Set(
    Array.isArray(record["required"]) ? record["required"].filter((item): item is string => typeof item === "string") : [],
  );
  if ([...required].some((id) => !Object.hasOwn(properties, id))) return null;
  const fields: PendingMcpElicitationField[] = [];
  for (const [id, fieldSchema] of Object.entries(properties)) {
    const field = mcpElicitationFieldFromSchema(id, fieldSchema, required.has(id));
    if (!field) return null;
    fields.push(field);
  }
  return fields;
}

function mcpElicitationFieldFromSchema(id: string, value: unknown, required: boolean): PendingMcpElicitationField | null {
  const schema = asRecordOrNull(value);
  if (!schema) return null;
  const base = {
    id,
    title: nonEmptyString(schema["title"]) ?? id,
    description: nonEmptyString(schema["description"]),
    required,
  };
  const defaultValue = schema["default"];
  const type = schema["type"];
  switch (type) {
    case "boolean":
      return { ...base, type, value: defaultValue === true };
    case "number":
    case "integer": {
      const minimum = optionalMcpNumber(schema["minimum"]);
      const maximum = optionalMcpNumber(schema["maximum"]);
      if (minimum === null || maximum === null) return null;
      return {
        ...base,
        type,
        ...definedProp("minimum", minimum),
        ...definedProp("maximum", maximum),
        value: typeof defaultValue === "number" && Number.isFinite(defaultValue) ? String(defaultValue) : "",
      };
    }
    case "array": {
      const items = asRecordOrNull(schema["items"]);
      const options = selectOptions(items?.["anyOf"], items?.["enum"]);
      const minItems = optionalMcpCardinality(schema["minItems"]);
      const maxItems = optionalMcpCardinality(schema["maxItems"]);
      if (!options || minItems === null || maxItems === null) return null;
      if (options.length === 0 && required && (minItems ?? 0n) > 0n) return null;
      const allowed = new Set(options.map((option) => option.value));
      return {
        ...base,
        type: "multi-select",
        options,
        value: Array.isArray(defaultValue)
          ? [...new Set(defaultValue.filter((item): item is string => typeof item === "string" && allowed.has(item)))]
          : [],
        ...definedProp("minItems", minItems),
        ...definedProp("maxItems", maxItems),
      };
    }
    case "string": {
      const minLength = optionalMcpLength(schema["minLength"]);
      const maxLength = optionalMcpLength(schema["maxLength"]);
      if (minLength === null || maxLength === null) return null;
      const stringBase = { ...base, ...definedProp("minLength", minLength), ...definedProp("maxLength", maxLength) };
      if (schema["oneOf"] !== undefined || schema["enum"] !== undefined) {
        const options = selectOptions(schema["oneOf"], schema["enum"]);
        if (!options || (options.length === 0 && required)) return null;
        return {
          ...stringBase,
          type: "single-select",
          options,
          value: typeof defaultValue === "string" && options.some((option) => option.value === defaultValue) ? defaultValue : null,
        };
      }
      return { ...stringBase, type: "string", value: typeof defaultValue === "string" ? defaultValue : "" };
    }
    default:
      return null;
  }
}

function optionalMcpNumber(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalMcpLength(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalMcpCardinality(value: unknown): bigint | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value === "bigint") return value >= 0n ? value : null;
  // JSON transport supplies numbers even though the generated Rust u64 binding is bigint.
  const count = optionalMcpLength(value);
  return count === null || count === undefined ? count : BigInt(count);
}

function selectOptions(choices: unknown, enumValues: unknown): PendingMcpElicitationOption[] | null {
  if (choices !== undefined) {
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const options: PendingMcpElicitationOption[] = [];
    for (const choice of choices) {
      const option = selectOption(choice);
      if (!option) return null;
      options.push(option);
    }
    return options;
  }
  if (!Array.isArray(enumValues) || !enumValues.every((value): value is string => typeof value === "string")) return null;
  return enumValues.map((value) => ({ value, label: value }));
}

function selectOption(value: unknown): PendingMcpElicitationOption | null {
  const record = asRecordOrNull(value);
  const optionValue = nullableString(record?.["const"]);
  if (optionValue === null) return null;
  return { value: optionValue, label: nonEmptyString(record?.["title"]) ?? optionValue };
}

function toJsonContent(content: Record<string, McpElicitationContentValue> | null): McpServerElicitationRequestResponse["content"] {
  if (!content) return null;
  return Object.fromEntries(Object.entries(content).map(([key, value]) => [key, typeof value === "object" ? Array.from(value) : value]));
}
