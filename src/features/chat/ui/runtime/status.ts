import { jsonPreview } from "../../../../domain/display/json-preview";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RateLimitWindow, SpendControlLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import {
  collaborationModeLabel,
  serviceTierLabel as formatServiceTierLabel,
  pendingRuntimeSettingLabel,
} from "../../domain/runtime/labels";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import type { ToolbarStatusRow as DiagnosticRow, RateLimitSummary } from "../toolbar/model";

interface ContextSummary {
  detail: string;
  percent: number | null;
}

type RateLimitSummaryRow = RateLimitSummary["rows"][number];

interface StatusDetailsInput {
  snapshot: RuntimeSnapshot;
  nowMs: number;
}

const CODEX_DEFAULT_LABEL = "(Codex default)";

function serviceTierLabel(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot): string {
  return formatServiceTierLabel(resolveRuntimeControls(snapshot, config).serviceTier.effective);
}

export function contextSummary(snapshot: RuntimeSnapshot): ContextSummary | null {
  const usage = snapshot.tokenUsage;
  const config = runtimeConfigOrDefault(snapshot.runtimeConfig);
  const contextWindow = usage?.modelContextWindow ?? config.modelContextWindow;
  if (!usage) {
    if (!snapshot.activeThreadId) return null;
    if (!snapshot.hasThreadTurns) {
      const detail = contextWindow
        ? `0 / ${formatTokenCount(contextWindow)} (0%). No turns in this thread yet.`
        : "0 tokens. No turns in this thread yet.";
      return {
        detail,
        percent: 0,
      };
    }
    const detail = contextWindow
      ? `usage is not available for this thread yet. It will update after the next token usage report. Context window: ${formatTokenCount(contextWindow)} tokens.`
      : "usage is not available for this thread yet. It will update after the next token usage report.";
    return {
      detail,
      percent: null,
    };
  }

  const used = contextUsageTokens(usage);
  const percent = contextWindow ? Math.min(100, Math.round((used / contextWindow) * 100)) : null;
  const detail = contextWindow
    ? `${formatTokenCount(used)} / ${formatTokenCount(contextWindow)} (${String(percent)}%). Latest usage: ${formatTokenCount(usage.last.inputTokens)} input, ${formatTokenCount(usage.last.outputTokens)} output, ${formatTokenCount(usage.last.reasoningOutputTokens)} reasoning. Total: ${formatTokenCount(usage.total.totalTokens)} tokens.`
    : `${formatTokenCount(used)} tokens. Latest usage: ${formatTokenCount(usage.last.totalTokens)} total. Total: ${formatTokenCount(usage.total.totalTokens)} tokens.`;
  return {
    detail,
    percent,
  };
}

export function rateLimitSummary(snapshot: RuntimeSnapshot, nowMs: number): RateLimitSummary | null {
  const rateLimit = snapshot.rateLimit;
  if (!rateLimit) return null;

  const reached = rateLimit.rateLimitReachedType !== null;
  const rows = [
    rateLimitWindowSummary("primary", rateLimit.primary, reached, nowMs),
    rateLimitWindowSummary("secondary", rateLimit.secondary, reached, nowMs),
    spendControlLimitSummary(rateLimit.individualLimit, nowMs),
  ].filter((row): row is RateLimitSummaryRow => row !== null);
  if (rows.length === 0) return null;

  return { rows };
}

export function statusDetails(input: StatusDetailsInput): DiagnosticRow[] {
  const context = contextSummary(input.snapshot);
  const limit = rateLimitSummary(input.snapshot, input.nowMs);
  return [
    { label: "Thread", value: input.snapshot.activeThreadId ?? "(none)" },
    { label: "Context", value: context ? context.detail : "not available" },
    { label: "Usage Limits", value: limit ? usageLimitValue(limit) : "not available" },
  ];
}

export function modelStatusDetails(snapshot: RuntimeSnapshot): DiagnosticRow[] {
  const config = runtimeConfigOrDefault(snapshot.runtimeConfig);
  const resolution = resolveRuntimeControls(snapshot, config);
  return [
    { label: "Model", value: resolution.model.effective ?? CODEX_DEFAULT_LABEL },
    { label: "Override", value: pendingRuntimeSettingLabel(snapshot.pending.model) },
    { label: "Provider", value: stringValue(config.modelProvider, CODEX_DEFAULT_LABEL) },
    { label: "Effort", value: resolution.reasoningEffort.effective ?? CODEX_DEFAULT_LABEL },
    { label: "Mode", value: collaborationModeLabel(resolution.collaborationMode.effective) },
    { label: "Service tier", value: serviceTierLabel(snapshot, config) },
  ];
}

export function effortStatusDetails(snapshot: RuntimeSnapshot): DiagnosticRow[] {
  const config = runtimeConfigOrDefault(snapshot.runtimeConfig);
  const resolution = resolveRuntimeControls(snapshot, config);
  return [
    { label: "Effort", value: resolution.reasoningEffort.effective ?? CODEX_DEFAULT_LABEL },
    { label: "Override", value: pendingRuntimeSettingLabel(snapshot.pending.reasoningEffort) },
    { label: "Supported", value: resolution.supportedReasoningEfforts.join(", ") },
  ];
}

function contextUsageTokens(usage: ThreadTokenUsage): number {
  return usage.last.inputTokens > 0 ? usage.last.inputTokens : usage.last.totalTokens;
}

function usageLimitValue(limit: RateLimitSummary): string {
  return limit.rows.map((row) => `${row.label} ${row.value}${row.resetLabel ? ` (${row.resetLabel})` : ""}`).join(", ");
}

function rateLimitWindowSummary(
  fallbackLabel: string,
  window: RateLimitWindow | null,
  reached: boolean,
  nowMs: number,
): RateLimitSummaryRow | null {
  if (!window) return null;

  const percent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
  const level = reached || percent >= 90 ? "danger" : percent >= 70 ? "warn" : "ok";
  const label = window.windowDurationMins ? formatRateLimitDuration(window.windowDurationMins) : fallbackLabel;
  const resetLabel = window.resetsAt ? formatRateLimitRemaining(window.resetsAt, nowMs) : null;
  return {
    label,
    value: `${String(percent)}%`,
    resetLabel,
    percent,
    meterDivisions: rateLimitMeterDivisions(window.windowDurationMins),
    level,
  };
}

function spendControlLimitSummary(limit: SpendControlLimitSnapshot | null, nowMs: number): RateLimitSummaryRow | null {
  if (!limit) return null;

  const remainingPercent = Math.max(0, Math.min(100, Math.round(limit.remainingPercent)));
  const percent = 100 - remainingPercent;
  const level = remainingPercent <= 10 ? "danger" : remainingPercent <= 30 ? "warn" : "ok";
  const resetLabel = limit.resetsAt ? formatRateLimitRemaining(limit.resetsAt, nowMs) : null;
  const value = `${limit.used} / ${limit.limit}`;
  return {
    label: "monthly",
    value,
    resetLabel,
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

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}
