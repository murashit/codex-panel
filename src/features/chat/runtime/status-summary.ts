import type { RateLimitWindow } from "../../../generated/app-server/v2/RateLimitWindow";
import type { SpendControlLimitSnapshot } from "../../../generated/app-server/v2/SpendControlLimitSnapshot";
import type { ThreadTokenUsage } from "../../../generated/app-server/v2/ThreadTokenUsage";
import { jsonPreview } from "../../../utils";
import { sortedModelOptions } from "../../../domain/catalog/metadata";
import { defaultEffortForModelOption } from "../../../domain/catalog/metadata";
import { readRuntimeConfig, type RuntimeConfigProjection } from "./config";
import {
  currentApprovalsReviewer,
  currentApprovalPolicy,
  currentModel,
  currentReasoningEffort,
  autoReviewActive,
  fastModeLabel,
  pendingRuntimeSettingLabel,
  serviceTierLabel,
  type RuntimeSnapshot,
} from "./effective-settings";

export interface ContextSummary {
  label: string;
  title: string;
  percent: number | null;
  level: "ok" | "warn" | "danger";
}

export interface RateLimitSummary {
  title: string;
  level: "ok" | "warn" | "danger";
  rows: RateLimitSummaryRow[];
}

interface RateLimitSummaryRow {
  label: string;
  value: string;
  resetLabel: string | null;
  title: string;
  percent: number;
  meterDivisions: number | null;
  level: "ok" | "warn" | "danger";
}

export interface EffectiveConfigSection {
  title: string;
  rows: { key: string; value: string }[];
}

const CODEX_DEFAULT_LABEL = "(Codex default)";
const NOT_REPORTED_LABEL = "(not reported)";

export function contextSummary(snapshot: RuntimeSnapshot): ContextSummary | null {
  const usage = snapshot.tokenUsage;
  const config = readRuntimeConfig(snapshot.effectiveConfig);
  const contextWindow = usage?.modelContextWindow ?? config.modelContextWindow;
  if (!usage) {
    if (!snapshot.activeThreadId) return null;
    if (!snapshot.hasThreadTurns) {
      return {
        label: "Context 0%",
        title: contextWindow
          ? `Context: 0 / ${formatTokenCount(contextWindow)} (0%). No turns in this thread yet.`
          : "Context: 0 tokens. No turns in this thread yet.",
        percent: 0,
        level: "ok",
      };
    }
    return {
      label: "Context unknown",
      title: contextWindow
        ? `Context usage is not available for this thread yet. It will update after the next token usage report. Context window: ${formatTokenCount(contextWindow)} tokens.`
        : "Context usage is not available for this thread yet. It will update after the next token usage report.",
      percent: null,
      level: "ok",
    };
  }

  const used = contextUsageTokens(usage);
  const percent = contextWindow ? Math.min(100, Math.round((used / contextWindow) * 100)) : null;
  const level = percent !== null && percent >= 90 ? "danger" : percent !== null && percent >= 70 ? "warn" : "ok";
  const title = contextWindow
    ? `Context: ${formatTokenCount(used)} / ${formatTokenCount(contextWindow)} (${String(percent)}%). Last request: ${formatTokenCount(usage.last.inputTokens)} input, ${formatTokenCount(usage.last.outputTokens)} output, ${formatTokenCount(usage.last.reasoningOutputTokens)} reasoning. Total: ${formatTokenCount(usage.total.totalTokens)} tokens.`
    : `Context: ${formatTokenCount(used)} tokens. Last request: ${formatTokenCount(usage.last.totalTokens)} total. Total: ${formatTokenCount(usage.total.totalTokens)} tokens.`;
  return {
    label: percent === null ? `${formatTokenCount(used)} tokens` : `Context ${String(percent)}%`,
    title,
    percent,
    level,
  };
}

export function rateLimitSummary(snapshot: RuntimeSnapshot, nowMs = Date.now()): RateLimitSummary | null {
  const rateLimit = snapshot.rateLimit;
  if (!rateLimit) return null;

  const name = rateLimit.limitName ?? rateLimit.limitId ?? "Codex limit";
  const reached = rateLimit.rateLimitReachedType !== null;
  const rows = [
    rateLimitWindowSummary("primary", rateLimit.primary, name, reached, rateLimit.rateLimitReachedType, nowMs),
    rateLimitWindowSummary("secondary", rateLimit.secondary, name, reached, rateLimit.rateLimitReachedType, nowMs),
    spendControlLimitSummary(rateLimit.individualLimit, name, nowMs),
  ].filter((row): row is RateLimitSummaryRow => row !== null);
  if (rows.length === 0) return null;

  const level = rows.some((row) => row.level === "danger") ? "danger" : rows.some((row) => row.level === "warn") ? "warn" : "ok";
  return {
    title: `${name}: ${rows.map((row) => `${row.label} ${row.value}`).join(", ")}`,
    rows,
    level,
  };
}

export function effectiveConfigSections(snapshot: RuntimeSnapshot, vaultPath: string): EffectiveConfigSection[] {
  const config = readRuntimeConfig(snapshot.effectiveConfig);
  return [
    {
      title: "Scope",
      rows: [
        { key: "cwd", value: vaultPath },
        { key: "profile", value: config.profile ?? "(default)" },
        { key: "model provider", value: stringValue(config.modelProvider, CODEX_DEFAULT_LABEL) },
      ],
    },
    {
      title: "Runtime",
      rows: [
        { key: "effective model", value: currentModel(snapshot, config) ?? CODEX_DEFAULT_LABEL },
        { key: "configured model", value: configuredModel(snapshot, config) ?? NOT_REPORTED_LABEL },
        { key: "thread model", value: activeRuntimeValueLabel(snapshot.activeModel) },
        { key: "requested model", value: pendingRuntimeSettingLabel(snapshot.requestedModel) },
        { key: "effective effort", value: currentReasoningEffort(snapshot, config) ?? CODEX_DEFAULT_LABEL },
        { key: "configured effort", value: configuredReasoningEffort(snapshot, config) ?? NOT_REPORTED_LABEL },
        { key: "thread effort", value: activeRuntimeValueLabel(snapshot.activeReasoningEffort) },
        { key: "requested effort", value: pendingRuntimeSettingLabel(snapshot.requestedReasoningEffort) },
        { key: "reasoning summary", value: stringValue(config.reasoningSummary, CODEX_DEFAULT_LABEL) },
        { key: "verbosity", value: stringValue(config.verbosity, CODEX_DEFAULT_LABEL) },
        { key: "effective mode", value: snapshot.activeCollaborationMode === "plan" ? "Plan" : "Default" },
        {
          key: "requested mode",
          value:
            snapshot.selectedCollaborationMode === snapshot.activeCollaborationMode
              ? "(none)"
              : modeLabel(snapshot.selectedCollaborationMode),
        },
        { key: "effective service tier", value: serviceTierLabel(snapshot, config) },
        { key: "configured service tier", value: config.serviceTier ?? CODEX_DEFAULT_LABEL },
        { key: "thread service tier", value: activeRuntimeValueLabel(snapshot.activeServiceTier) },
        { key: "requested service tier", value: pendingRuntimeSettingLabel(snapshot.requestedServiceTier) },
        { key: "fast mode", value: fastModeLabel(snapshot, config) },
        { key: "context window", value: tokenLimitLabel(config.modelContextWindow) },
        { key: "auto compact limit", value: tokenLimitLabel(config.autoCompactTokenLimit) },
      ],
    },
    {
      title: "Policy",
      rows: [
        { key: "effective approval", value: stringValue(currentApprovalPolicy(snapshot, config), CODEX_DEFAULT_LABEL) },
        { key: "configured approval", value: stringValue(config.approvalPolicy, CODEX_DEFAULT_LABEL) },
        { key: "thread approval", value: stringValue(snapshot.activeApprovalPolicy, NOT_REPORTED_LABEL) },
        { key: "active permissions", value: activePermissionProfileLabel(snapshot.activePermissionProfile) },
        { key: "effective reviewer", value: currentApprovalsReviewer(snapshot, config) ?? NOT_REPORTED_LABEL },
        { key: "auto-review", value: autoReviewActive(snapshot, config) ? "on" : "off" },
        { key: "configured reviewer", value: config.approvalsReviewer ?? CODEX_DEFAULT_LABEL },
        { key: "thread reviewer", value: activeRuntimeValueLabel(snapshot.activeApprovalsReviewer) },
        { key: "requested reviewer", value: pendingRuntimeSettingLabel(snapshot.requestedApprovalsReviewer) },
        { key: "sandbox", value: stringValue(config.sandboxMode, CODEX_DEFAULT_LABEL) },
        { key: "workspace network", value: stringValue(config.workspaceNetworkAccess, CODEX_DEFAULT_LABEL) },
        { key: "writable roots", value: writableRootsLabel(config.writableRoots) },
        { key: "web search", value: stringValue(config.webSearch, CODEX_DEFAULT_LABEL) },
      ],
    },
    {
      title: "Features",
      rows: [
        { key: "tool web search", value: stringValue(config.toolWebSearch, CODEX_DEFAULT_LABEL) },
        { key: "apps", value: enabledAppsLabel(config.apps) },
      ],
    },
  ];
}

function contextUsageTokens(usage: ThreadTokenUsage): number {
  return usage.last.inputTokens > 0 ? usage.last.inputTokens : usage.last.totalTokens;
}

function configuredModel(snapshot: RuntimeSnapshot, config: RuntimeConfigProjection): string | null {
  if (config.model) return config.model;
  return sortedModelOptions(snapshot.availableModels).find((model) => model.isDefault)?.model ?? null;
}

function configuredReasoningEffort(snapshot: RuntimeSnapshot, config: RuntimeConfigProjection): string | null {
  if (config.rawReasoningEffort) return config.rawReasoningEffort;
  const model = configuredModel(snapshot, config);
  return defaultEffortForModelOption(
    sortedModelOptions(snapshot.availableModels).find((availableModel) => availableModel.model === model) ?? null,
  );
}

function modeLabel(mode: RuntimeSnapshot["selectedCollaborationMode"]): string {
  return mode === "plan" ? "Plan" : "Default";
}

function activeRuntimeValueLabel(value: string | null): string {
  return value ?? NOT_REPORTED_LABEL;
}

function activePermissionProfileLabel(profile: RuntimeSnapshot["activePermissionProfile"]): string {
  if (!profile) return NOT_REPORTED_LABEL;
  return profile.extends ? `${profile.id} extends ${profile.extends}` : profile.id;
}

function rateLimitWindowSummary(
  fallbackLabel: string,
  window: RateLimitWindow | null,
  name: string,
  reached: boolean,
  reachedType: string | null,
  nowMs: number,
): RateLimitSummaryRow | null {
  if (!window) return null;

  const percent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
  const level = reached || percent >= 90 ? "danger" : percent >= 70 ? "warn" : "ok";
  const label = window.windowDurationMins ? formatRateLimitDuration(window.windowDurationMins) : fallbackLabel;
  const resetLabel = window.resetsAt ? formatRateLimitRemaining(window.resetsAt, nowMs) : null;
  const resetText = window.resetsAt && resetLabel ? ` ${capitalize(resetLabel)}. Reset at ${formatRateLimitReset(window.resetsAt)}.` : "";
  const reachedText = reached ? ` ${String(reachedType)}.` : "";
  return {
    label,
    value: `${String(percent)}%`,
    resetLabel,
    title: `${name} ${label}: ${String(percent)}% used.${resetText}${reachedText}`,
    percent,
    meterDivisions: rateLimitMeterDivisions(window.windowDurationMins),
    level,
  };
}

function spendControlLimitSummary(limit: SpendControlLimitSnapshot | null, name: string, nowMs: number): RateLimitSummaryRow | null {
  if (!limit) return null;

  const remainingPercent = Math.max(0, Math.min(100, Math.round(limit.remainingPercent)));
  const percent = 100 - remainingPercent;
  const level = remainingPercent <= 10 ? "danger" : remainingPercent <= 30 ? "warn" : "ok";
  const resetLabel = limit.resetsAt ? formatRateLimitRemaining(limit.resetsAt, nowMs) : null;
  const resetText = limit.resetsAt && resetLabel ? ` ${capitalize(resetLabel)}. Reset at ${formatRateLimitReset(limit.resetsAt)}.` : "";
  const value = `${limit.used} / ${limit.limit}`;
  return {
    label: "monthly",
    value,
    resetLabel,
    title: `${name} monthly limit: ${value} used, ${String(remainingPercent)}% remaining.${resetText}`,
    percent,
    meterDivisions: null,
    level,
  };
}

function rateLimitMeterDivisions(minutes: number | null): number | null {
  if (minutes === 300) return 5;
  if (minutes === 10_080) return 7;
  return null;
}

function formatRateLimitDuration(minutes: number): string {
  if (minutes === 10_080) return "1w";
  if (minutes % 60 === 0) return `${String(minutes / 60)}h`;
  return `${String(minutes)}m`;
}

function formatRateLimitReset(resetsAt: number): string {
  return new Date(resetsAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatRateLimitRemaining(resetsAt: number, nowMs: number): string {
  const remainingSeconds = Math.ceil((resetsAt * 1000 - nowMs) / 1000);
  if (remainingSeconds <= 0) return "reset due";
  if (remainingSeconds < 60) return "reset in <1m";

  const minutes = Math.ceil(remainingSeconds / 60);
  if (minutes < 60) return `reset in ${String(minutes)}m`;

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return `reset in ${String(hours)}h${remainderMinutes > 0 ? ` ${String(remainderMinutes)}m` : ""}`;

  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return `reset in ${String(days)}d${remainderHours > 0 ? ` ${String(remainderHours)}h` : ""}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function tokenLimitLabel(value: unknown): string {
  const tokens = toNumber(value);
  return tokens === null ? CODEX_DEFAULT_LABEL : formatTokenCount(tokens);
}

function writableRootsLabel(value: unknown): string {
  if (!Array.isArray(value)) return CODEX_DEFAULT_LABEL;
  if (value.length === 0) return "none";
  if (value.length === 1) return String(value[0]);
  return `${String(value.length)} roots`;
}

function enabledAppsLabel(apps: unknown): string {
  const appConfig = asRecord(apps);
  const enabled = Object.entries(appConfig)
    .filter(([key, app]) => key !== "_default" && asRecord(app)["enabled"] === true)
    .map(([key]) => key)
    .sort();
  if (enabled.length > 0) return enabled.join(", ");
  const defaultConfig = asRecord(appConfig["_default"]);
  return stringValue(defaultConfig["enabled"], CODEX_DEFAULT_LABEL);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}
