import { describe, expect, it } from "vitest";

import {
  accountRateLimitsSummaryFromResponse,
  rateLimitSnapshotFromAccountRateLimitsResponse,
} from "../../src/app-server/protocol/runtime-metrics";

type AccountRateLimitsResponse = Parameters<typeof rateLimitSnapshotFromAccountRateLimitsResponse>[0];
type AppServerRateLimitSnapshot = AccountRateLimitsResponse["rateLimits"];

describe("app-server runtime metrics", () => {
  it("projects the codex rate limit bucket when multi-bucket limits are available", () => {
    expect(
      rateLimitSnapshotFromAccountRateLimitsResponse({
        rateLimits: appServerRateLimitFixture("legacy", 12),
        rateLimitsByLimitId: {
          other: appServerRateLimitFixture("other", 34),
          codex: appServerRateLimitFixture("codex", 56),
        },
      }),
    ).toMatchObject({ limitId: "codex", primary: { usedPercent: 56 } });
  });

  it("falls back to the legacy rate limit snapshot when no codex bucket is available", () => {
    expect(
      rateLimitSnapshotFromAccountRateLimitsResponse({
        rateLimits: appServerRateLimitFixture("legacy", 12),
        rateLimitsByLimitId: {
          other: appServerRateLimitFixture("other", 34),
        },
      }),
    ).toMatchObject({ limitId: "legacy", primary: { usedPercent: 12 } });
  });

  it("summarizes account rate limit response availability", () => {
    expect(
      accountRateLimitsSummaryFromResponse({
        rateLimits: appServerRateLimitFixture("legacy", 12),
        rateLimitsByLimitId: {
          codex: appServerRateLimitFixture("codex", 56),
          other: appServerRateLimitFixture("other", 34),
        },
      }),
    ).toBe("2 limits");

    expect(
      accountRateLimitsSummaryFromResponse({
        rateLimits: appServerRateLimitFixture("legacy", 12),
        rateLimitsByLimitId: null,
      }),
    ).toBe("available");
  });
});

function appServerRateLimitFixture(limitId: string, usedPercent: number): AppServerRateLimitSnapshot {
  return {
    limitId,
    limitName: limitId,
    primary: { usedPercent, windowDurationMins: 300, resetsAt: null },
    secondary: null,
    credits: null,
    individualLimit: null,
    planType: null,
    rateLimitReachedType: null,
  };
}
