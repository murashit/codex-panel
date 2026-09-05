import { describe, expect, it } from "vitest";

import {
  accountRateLimitsSummaryFromResponse,
  rateLimitSnapshotFromAccountRateLimitsResponse,
} from "../../../src/app-server/protocol/runtime-metrics";

type AccountRateLimitsResponse = Parameters<typeof rateLimitSnapshotFromAccountRateLimitsResponse>[0];
type AppServerRateLimitSnapshot = AccountRateLimitsResponse["rateLimits"];

describe("app-server runtime metrics", () => {
  it("projects the codex rate limit bucket when multi-bucket limits are available", () => {
    expect(
      rateLimitSnapshotFromAccountRateLimitsResponse({
        rateLimits: appServerRateLimitFixture("single-bucket", 12),
        rateLimitsByLimitId: {
          other: appServerRateLimitFixture("other", 34),
          codex: {
            ...appServerRateLimitFixture("codex", 56),
            secondary: { usedPercent: 78, windowDurationMins: 10_080, resetsAt: 123 },
          },
        },
      }),
    ).toMatchObject({
      limitId: "codex",
      primary: { usedPercent: 56, windowDurationMins: 300, resetsAt: null },
      secondary: { usedPercent: 78, windowDurationMins: 10_080, resetsAt: 123 },
    });
  });

  it("falls back to the single-bucket rate limit snapshot when no codex bucket is available", () => {
    expect(
      rateLimitSnapshotFromAccountRateLimitsResponse({
        rateLimits: appServerRateLimitFixture("single-bucket", 12),
        rateLimitsByLimitId: {
          other: appServerRateLimitFixture("other", 34),
        },
      }),
    ).toMatchObject({ limitId: "single-bucket", primary: { usedPercent: 12 } });
  });

  it("projects the individual spend-control limit", () => {
    const rateLimit = appServerRateLimitFixture("codex", 25);
    rateLimit.individualLimit = { limit: "100", used: "25", remainingPercent: 75, resetsAt: 123 };

    expect(rateLimitSnapshotFromAccountRateLimitsResponse({ rateLimits: rateLimit, rateLimitsByLimitId: null }).individualLimit).toEqual({
      limit: "100",
      used: "25",
      remainingPercent: 75,
      resetsAt: 123,
    });
  });

  it("summarizes account rate limit response availability", () => {
    expect(
      accountRateLimitsSummaryFromResponse({
        rateLimits: appServerRateLimitFixture("single-bucket", 12),
        rateLimitsByLimitId: {
          codex: appServerRateLimitFixture("codex", 56),
          other: appServerRateLimitFixture("other", 34),
        },
      }),
    ).toBe("2 limits");

    expect(
      accountRateLimitsSummaryFromResponse({
        rateLimits: appServerRateLimitFixture("single-bucket", 12),
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
