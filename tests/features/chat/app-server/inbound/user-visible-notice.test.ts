import { describe, expect, it } from "vitest";
import type { UserVisibleNoticeNotification } from "../../../../../src/features/chat/app-server/inbound/notification-routing";
import { userVisibleNoticeItem } from "../../../../../src/features/chat/app-server/inbound/user-visible-notice";

function visibleText(notification: UserVisibleNoticeNotification): string {
  const item = userVisibleNoticeItem(notification, "notice-1");
  if (item?.kind !== "system") throw new Error("Expected a system notice");
  expect(item.id).toBe("notice-1");
  return [
    item.text,
    ...(item.noticeSections ?? []).flatMap((section) => [
      section.title,
      section.body,
      ...(section.auditFacts ?? []).map((fact) => `${fact.key}: ${fact.value}`),
    ]),
  ]
    .filter(Boolean)
    .join("\n");
}

describe("user-visible server notices", () => {
  it("shows warning and migration guidance without transport fields", () => {
    expect(visibleText({ method: "warning", params: { message: "A tool is unavailable.", threadId: "routing-thread" } })).toBe(
      "A tool is unavailable.",
    );
    expect(
      visibleText({ method: "deprecationNotice", params: { summary: "This setting is deprecated.", details: "Use the new setting." } }),
    ).toBe("This setting is deprecated.\nUse the new setting.");
  });

  it("explains a model switch without exposing routing identifiers", () => {
    const text = visibleText({
      method: "model/rerouted",
      params: {
        threadId: "routing-thread",
        turnId: "routing-turn",
        fromModel: "original-model",
        toModel: "replacement-model",
        reason: "highRiskCyberActivity",
      },
    });
    expect(text).toContain("replacement-model");
    expect(text).toContain("original-model");
    expect(text).toContain("high-risk cyber activity");
    expect(text).not.toMatch(/routing-|model\/rerouted|highRiskCyberActivity/);
  });

  it.each([true, false])("preserves error explanation and retry state (%s)", (willRetry) => {
    const text = visibleText({
      method: "error",
      params: {
        threadId: "routing-thread",
        turnId: "routing-turn",
        willRetry,
        error: {
          message: "The request failed.",
          additionalDetails: "The provider is temporarily unavailable.",
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } },
          misalignment: {
            errorType: "opaque-classification",
            detailedExplanation: "The request needs clarification.",
            steer: { message: "Please proceed with the clarified request." },
          },
        },
      },
    });
    expect(text).toContain("The request failed.");
    expect(text).toContain("The provider is temporarily unavailable.");
    expect(text).toContain("The request needs clarification.");
    expect(text).toContain("HTTP status: 503");
    expect(text).toContain("Suggested continuation input\nPlease proceed with the clarified request.");
    expect(text).toContain(willRetry ? "will retry automatically" : "will not retry automatically");
    expect(text).not.toMatch(/routing-|opaque-classification|httpConnectionFailed/);
  });

  it("retains config guidance and the one-based source location", () => {
    expect(
      visibleText({
        method: "configWarning",
        params: {
          summary: "Unknown setting.",
          details: "Remove the obsolete key.",
          path: "/config/codex.toml",
          range: { start: { line: 2, column: 4 }, end: { line: 2, column: 9 } },
        },
      }),
    ).toBe("Unknown setting.\nRemove the obsolete key.\nConfig file: /config/codex.toml\nLocation: 2:4–2:9");
    expect(visibleText({ method: "configWarning", params: { summary: "Invalid configuration.", details: null } })).toBe(
      "Invalid configuration.",
    );
  });

  it("retains affected Windows paths, omitted counts and scan failure", () => {
    const text = visibleText({
      method: "windows/worldWritableWarning",
      params: {
        samplePaths: ["C:\\shared", "C:\\temp"],
        extraCount: 3,
        failedScan: true,
      },
    });
    expect(text).toContain("Paths writable by everyone\nC:\\shared\nC:\\temp");
    expect(text).toContain("3 additional paths");
    expect(text).toContain("scan could not be completed");
  });

  it("shows sandbox setup failures and suppresses successful setup", () => {
    expect(
      visibleText({
        method: "windowsSandbox/setupCompleted",
        params: {
          success: false,
          mode: "elevated",
          error: "Permission was denied.",
        },
      }),
    ).toBe("Windows sandbox setup failed.\nPermission was denied.");
    expect(
      userVisibleNoticeItem(
        {
          method: "windowsSandbox/setupCompleted",
          params: {
            success: true,
            mode: "unelevated",
            error: null,
          },
        },
        "notice-1",
      ),
    ).toBeNull();
  });
});
