import type { RateLimitWindow } from "../generated/app-server/v2/RateLimitWindow";
import type { ThreadTokenUsage } from "../generated/app-server/v2/ThreadTokenUsage";
import { jsonPreview } from "../utils";
import {
  configRecord,
  currentModel,
  currentReasoningEffort,
  fastModeLabel,
  runtimeOverrideLabel,
  serviceTierLabel,
  type RuntimeSnapshot,
} from "./state";

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

export interface RateLimitSummaryRow {
  label: string;
  value: string;
  resetLabel: string | null;
  title: string;
  percent: number;
  level: "ok" | "warn" | "danger";
}

export interface EffectiveConfigSection {
  title: string;
  rows: Array<{ key: string; value: string }>;
}

export function contextSummary(snapshot: RuntimeSnapshot): ContextSummary | null {
  const usage = snapshot.tokenUsage;
  const config = configRecord(snapshot.effectiveConfig);
  const contextWindow = usage?.modelContextWindow ?? toNumber(config.model_context_window);
  if (!usage) {
    if (!snapshot.activeThreadId) return null;
    if (!snapshot.displayItems.some((item) => item.turnId)) {
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
    ? `Context: ${formatTokenCount(used)} / ${formatTokenCount(contextWindow)} (${percent}%). Last request: ${formatTokenCount(usage.last.inputTokens)} input, ${formatTokenCount(usage.last.outputTokens)} output, ${formatTokenCount(usage.last.reasoningOutputTokens)} reasoning. Session total: ${formatTokenCount(usage.total.totalTokens)} tokens.`
    : `Context: ${formatTokenCount(used)} tokens. Last request: ${formatTokenCount(usage.last.totalTokens)} total. Session total: ${formatTokenCount(usage.total.totalTokens)} tokens.`;
  return {
    label: percent === null ? `${formatTokenCount(used)} tokens` : `Context ${percent}%`,
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
  const config = configRecord(snapshot.effectiveConfig);
  const features = asRecord(config.features);
  const tools = asRecord(config.tools);
  const workspaceWrite = asRecord(config.sandbox_workspace_write);
  return [
    {
      title: "Scope",
      rows: [
        { key: "cwd", value: vaultPath },
        { key: "profile", value: stringValue(config.profile, "(default)") },
        { key: "model provider", value: stringValue(config.model_provider, "(from default)") },
      ],
    },
    {
      title: "Runtime",
      rows: [
        { key: "model", value: currentModel(snapshot, config) ?? "(from default)" },
        { key: "model override", value: runtimeOverrideLabel(snapshot.requestedModel) },
        { key: "effort", value: currentReasoningEffort(snapshot, config) ?? "(from default)" },
        { key: "effort override", value: runtimeOverrideLabel(snapshot.requestedReasoningEffort) },
        { key: "reasoning summary", value: stringValue(config.model_reasoning_summary, "(from default)") },
        { key: "verbosity", value: stringValue(config.model_verbosity, "(from default)") },
        { key: "mode", value: snapshot.requestedCollaborationMode === "plan" ? "Plan" : "Default" },
        { key: "service tier", value: serviceTierLabel(snapshot, config) },
        { key: "fast mode", value: fastModeLabel(snapshot, config) },
        { key: "context window", value: tokenLimitLabel(config.model_context_window) },
        { key: "auto compact limit", value: tokenLimitLabel(config.model_auto_compact_token_limit) },
      ],
    },
    {
      title: "Policy",
      rows: [
        { key: "approval", value: stringValue(config.approval_policy, "(from default)") },
        { key: "reviewer", value: stringValue(config.approvals_reviewer, "(from default)") },
        { key: "sandbox", value: stringValue(config.sandbox_mode, "(from default)") },
        { key: "workspace network", value: stringValue(workspaceWrite.network_access, "(from default)") },
        { key: "writable roots", value: writableRootsLabel(workspaceWrite.writable_roots) },
        { key: "web search", value: stringValue(config.web_search, "(from default)") },
      ],
    },
    {
      title: "Features",
      rows: [
        { key: "hooks", value: stringValue(features.hooks, "(from default)") },
        { key: "apply patch freeform", value: stringValue(features.apply_patch_freeform, "(from default)") },
        { key: "tool web search", value: stringValue(tools.web_search, "(from default)") },
        { key: "apps", value: enabledAppsLabel(config.apps) },
      ],
    },
  ];
}

function contextUsageTokens(usage: ThreadTokenUsage): number {
  return usage.last.inputTokens > 0 ? usage.last.inputTokens : usage.last.totalTokens;
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
    value: `${percent}%`,
    resetLabel,
    title: `${name} ${label}: ${percent}% used.${resetText}${reachedText}`,
    percent,
    level,
  };
}

function formatRateLimitDuration(minutes: number): string {
  if (minutes === 10_080) return "1w";
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function formatRateLimitReset(resetsAt: number): string {
  return new Date(resetsAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatRateLimitRemaining(resetsAt: number, nowMs: number): string {
  const remainingSeconds = Math.ceil((resetsAt * 1000 - nowMs) / 1000);
  if (remainingSeconds <= 0) return "reset due";
  if (remainingSeconds < 60) return "reset in <1m";

  const minutes = Math.ceil(remainingSeconds / 60);
  if (minutes < 60) return `reset in ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return `reset in ${hours}h${remainderMinutes > 0 ? ` ${remainderMinutes}m` : ""}`;

  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return `reset in ${days}d${remainderHours > 0 ? ` ${remainderHours}h` : ""}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function tokenLimitLabel(value: unknown): string {
  const tokens = toNumber(value);
  return tokens === null ? "(from default)" : formatTokenCount(tokens);
}

function writableRootsLabel(value: unknown): string {
  if (!Array.isArray(value)) return "(from default)";
  if (value.length === 0) return "none";
  if (value.length === 1) return String(value[0]);
  return `${value.length} roots`;
}

function enabledAppsLabel(value: unknown): string {
  const apps = asRecord(value);
  const enabled = Object.entries(apps)
    .filter(([key, app]) => key !== "_default" && asRecord(app).enabled === true)
    .map(([key]) => key)
    .sort();
  if (enabled.length > 0) return enabled.join(", ");
  const defaultConfig = asRecord(apps._default);
  return stringValue(defaultConfig.enabled, "(from default)");
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
