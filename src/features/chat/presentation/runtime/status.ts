import { jsonPreview } from "../../../../domain/display/json-preview";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RateLimitWindow, SpendControlLimitSnapshot, ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import { serviceTierLabel as formatServiceTierLabel, pendingRuntimeSettingLabel } from "../../domain/runtime/labels";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import type { DiagnosticRow } from "./diagnostic-sections";

export interface ContextSummary {
  label: string;
  title: string;
  detail: string;
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

export interface StatusDetailsInput {
  activeThreadId: RuntimeSnapshot["activeThreadId"];
  snapshot: RuntimeSnapshot;
  nowMs: number;
}

export interface ModelStatusDetailsInput {
  runtimeConfig: RuntimeSnapshot["runtimeConfig"];
  pendingModel: RuntimeSnapshot["pending"]["model"];
  snapshot: RuntimeSnapshot;
  collaborationModeLabel: string;
}

export interface EffortStatusDetailsInput {
  runtimeConfig: RuntimeSnapshot["runtimeConfig"];
  pendingReasoningEffort: RuntimeSnapshot["pending"]["reasoningEffort"];
  snapshot: RuntimeSnapshot;
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
        label: "Context 0%",
        title: `Context: ${detail}`,
        detail,
        percent: 0,
        level: "ok",
      };
    }
    const detail = contextWindow
      ? `usage is not available for this thread yet. It will update after the next token usage report. Context window: ${formatTokenCount(contextWindow)} tokens.`
      : "usage is not available for this thread yet. It will update after the next token usage report.";
    return {
      label: "Context unknown",
      title: `Context ${detail}`,
      detail,
      percent: null,
      level: "ok",
    };
  }

  const used = contextUsageTokens(usage);
  const percent = contextWindow ? Math.min(100, Math.round((used / contextWindow) * 100)) : null;
  const level = percent !== null && percent >= 90 ? "danger" : percent !== null && percent >= 70 ? "warn" : "ok";
  const detail = contextWindow
    ? `${formatTokenCount(used)} / ${formatTokenCount(contextWindow)} (${String(percent)}%). Latest usage: ${formatTokenCount(usage.last.inputTokens)} input, ${formatTokenCount(usage.last.outputTokens)} output, ${formatTokenCount(usage.last.reasoningOutputTokens)} reasoning. Total: ${formatTokenCount(usage.total.totalTokens)} tokens.`
    : `${formatTokenCount(used)} tokens. Latest usage: ${formatTokenCount(usage.last.totalTokens)} total. Total: ${formatTokenCount(usage.total.totalTokens)} tokens.`;
  return {
    label: percent === null ? `${formatTokenCount(used)} tokens` : `Context ${String(percent)}%`,
    title: `Context: ${detail}`,
    detail,
    percent,
    level,
  };
}

export function rateLimitSummary(snapshot: RuntimeSnapshot, nowMs: number): RateLimitSummary | null {
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

export function statusDetails(input: StatusDetailsInput): DiagnosticRow[] {
  const context = contextSummary(input.snapshot);
  const limit = rateLimitSummary(input.snapshot, input.nowMs);
  return [
    { label: "Thread", value: input.activeThreadId ?? "(none)" },
    { label: "Context", value: context ? context.detail : "not available" },
    { label: "Usage Limits", value: limit ? usageLimitValue(limit) : "not available" },
  ];
}

export function modelStatusDetails(input: ModelStatusDetailsInput): DiagnosticRow[] {
  const config = runtimeConfigOrDefault(input.runtimeConfig);
  const resolution = resolveRuntimeControls(input.snapshot, config);
  return [
    { label: "Model", value: resolution.model.effective ?? CODEX_DEFAULT_LABEL },
    { label: "Override", value: pendingRuntimeSettingLabel(input.pendingModel) },
    { label: "Provider", value: stringValue(config.modelProvider, CODEX_DEFAULT_LABEL) },
    { label: "Effort", value: resolution.reasoningEffort.effective ?? CODEX_DEFAULT_LABEL },
    { label: "Mode", value: input.collaborationModeLabel },
    { label: "Service tier", value: serviceTierLabel(input.snapshot, config) },
  ];
}

export function effortStatusDetails(input: EffortStatusDetailsInput): DiagnosticRow[] {
  const config = runtimeConfigOrDefault(input.runtimeConfig);
  const resolution = resolveRuntimeControls(input.snapshot, config);
  return [
    { label: "Effort", value: resolution.reasoningEffort.effective ?? CODEX_DEFAULT_LABEL },
    { label: "Override", value: pendingRuntimeSettingLabel(input.pendingReasoningEffort) },
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(resetsAt * 1000);
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

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  return jsonPreview(value);
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}
