import { describe, expect, it } from "vitest";
import { contextSummary, rateLimitSummary, statusDetails } from "../../../../../src/features/chat/presentation/runtime/status";
import { runtimeSnapshot } from "../../domain/runtime/support";

describe("runtime status presentation", () => {
  it("summarizes context meter state from one runtime snapshot", () => {
    const snapshot = runtimeSnapshot({ activeThreadId: "thread" });
    expect(contextSummary(snapshot)).toMatchObject({
      label: "Context 0%",
      title: "Context: 0 / 100,000 (0%). No turns in this thread yet.",
      percent: 0,
      level: "ok",
    });
    expect(
      contextSummary(
        runtimeSnapshot({
          activeThreadId: "thread",
          tokenUsage: {
            last: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 50, totalTokens: 1250 },
            total: { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 100, totalTokens: 2600 },
            modelContextWindow: 100_000,
          },
        }),
      ),
    ).toMatchObject({
      title: "Context: 1,000 / 100,000 (1%). Latest usage: 1,000 input, 200 output, 50 reasoning. Total: 2,600 tokens.",
    });
    expect(
      contextSummary(
        runtimeSnapshot({
          activeThreadId: "thread",
          hasThreadTurns: true,
        }),
      ),
    ).toMatchObject({
      label: "Context unknown",
      percent: null,
    });
  });

  it("summarizes Codex usage limits independently from context usage", () => {
    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 72.4, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        1_799_991_600_000,
      ),
    ).toMatchObject({
      rows: [{ label: "5h", value: "72%", resetLabel: "reset in 2h 20m", percent: 72, meterDivisions: 5 }],
      level: "warn",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: null,
            primary: { usedPercent: 95, windowDurationMins: null, resetsAt: null },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: "rate_limit_reached",
          },
        }),
        0,
      ),
    ).toMatchObject({
      rows: [{ percent: 95, resetLabel: null }],
      level: "danger",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: null },
            secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: null },
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        0,
      ),
    ).toMatchObject({
      rows: [
        { label: "5h", value: "15%", meterDivisions: 5 },
        { label: "1w", value: "38%", meterDivisions: 7 },
      ],
      level: "ok",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        1_800_000_001_000,
      ),
    ).toMatchObject({
      rows: [{ resetLabel: "reset due" }],
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: null,
            secondary: null,
            individualLimit: { limit: "$100", used: "$72", remainingPercent: 28, resetsAt: 1_800_000_000 },
            rateLimitReachedType: null,
          },
        }),
        1_799_991_600_000,
      ),
    ).toMatchObject({
      rows: [{ label: "monthly", value: "$72 / $100", resetLabel: "reset in 2h 20m", percent: 72, meterDivisions: null }],
      level: "warn",
    });
  });

  it("formats runtime status details as flat rows", () => {
    expect(
      statusDetails({
        activeThreadId: "thread",
        snapshot: runtimeSnapshot({
          activeThreadId: "thread",
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: null },
            secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: null },
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        nowMs: 0,
      }),
    ).toEqual([
      { label: "Thread", value: "thread" },
      { label: "Context", value: "0 / 100,000 (0%). No turns in this thread yet." },
      { label: "Usage Limits", value: "5h 15%, 1w 38%" },
    ]);
  });
});
