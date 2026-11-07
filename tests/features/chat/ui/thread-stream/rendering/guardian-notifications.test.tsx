// @vitest-environment jsdom

import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { ServerNotification } from "../../../../../../src/app-server/connection/rpc-messages";
import { createChatInboundHandler } from "../../../../../../src/features/chat/app-server/inbound/handler";
import { createLocalIdSource } from "../../../../../../src/features/chat/application/local-id-source";
import { createChatStateStore } from "../../../../../../src/features/chat/application/state/store";
import { activeTurnId } from "../../../../../../src/features/chat/application/turns/turn-state";
import { appServerAgentMessageFixture, appServerTurnFixture, appServerUserMessageFixture } from "../../../../../support/app-server-records";
import { textContents } from "../../../../../support/dom";
import { chatStateFixture } from "../../../support/state";
import { chatStateThreadStreamItems } from "../../../support/thread-stream";
import { setupThreadStreamRendering } from "./setup";
import { projectedThreadStream, renderThreadStreamBlocksInAct, testDisclosures, unmountUiRootInAct } from "./test-helpers";

setupThreadStreamRendering();

const commandWarning = "Automatic approval review approved (risk: low, authorization: high): Running the requested test suite is allowed.";
const nativeWarning = "Automatic approval review approved (risk: low, authorization: high): Spawning the requested scout is allowed.";
type CompletedReview = Extract<ServerNotification, { method: "item/autoApprovalReview/completed" }>;

function completedReview(overrides: Partial<CompletedReview["params"]> = {}): CompletedReview {
  return {
    method: "item/autoApprovalReview/completed",
    params: {
      threadId: "thread",
      turnId: "turn",
      startedAtMs: 1,
      completedAtMs: 2,
      reviewId: "review-1",
      targetItemId: "command-1",
      decisionSource: "agent",
      review: {
        status: "approved",
        riskLevel: "low",
        userAuthorization: "high",
        rationale: "Running the requested test suite is allowed.",
      },
      action: { type: "command", source: "shell", command: "npm test", cwd: "/vault" },
      ...overrides,
    },
  };
}

function reviewDisplay() {
  const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
  // The effect boundary would name the thread or execute a tool. Neither is part of notification presentation.
  const handler = createChatInboundHandler(
    store,
    { maybeNameThread: vi.fn(), executeDynamicTool: vi.fn(() => ({ success: false, contentItems: [] })) },
    createLocalIdSource({ nowMs: () => 1, seed: "guardian-display" }),
  );
  const parent = document.createElement("div");
  onTestFinished(() => unmountUiRootInAct(parent));
  const items = () => chatStateThreadStreamItems(store.getState());
  return {
    parent,
    items,
    send: handler.handleNotification,
    warning: (message: string) => handler.handleNotification({ method: "guardianWarning", params: { threadId: "thread", message } }),
    start: (turnId = "turn") =>
      handler.handleNotification({
        method: "turn/started",
        params: { threadId: "thread", turn: appServerTurnFixture({ id: turnId, status: "inProgress", itemsView: "full", items: [] }) },
      }),
    render: (expanded = false) => {
      renderThreadStreamBlocksInAct(
        parent,
        projectedThreadStream({
          items: items(),
          activeTurnId: activeTurnId(store.getState().activeTurn),
          disclosures: testDisclosures(
            expanded
              ? {
                  details: items().map((item) => `${item.id}:review-details`),
                  activityGroups: ["turn"],
                }
              : {},
          ),
        }),
      );
      return textContents(parent, ".codex-panel__stream-item--review-result > .codex-panel__stream-summary");
    },
  };
}

function notificationBodies(parent: HTMLElement): (string | null | undefined)[] {
  return [...parent.querySelectorAll(".codex-panel__output-title")]
    .filter((title) => title.textContent === "Notification with matching assessment" || title.textContent === "Guardian notification")
    .map((title) => title.parentElement?.querySelector("pre")?.textContent);
}

describe("Guardian notification presentation", () => {
  it("retains independent native notices and folds only a complete command assessment in the live and settled UI", () => {
    const display = reviewDisplay();
    display.start();
    display.warning(nativeWarning);
    const completed = completedReview();
    display.send({
      method: "item/autoApprovalReview/started",
      params: {
        threadId: "thread",
        turnId: "turn",
        reviewId: "review-1",
        targetItemId: "command-1",
        startedAtMs: 1,
        action: { type: "command", source: "shell", command: "npm test", cwd: "/vault" },
        review: { status: "inProgress", riskLevel: null, userAuthorization: null, rationale: null },
      },
    });
    expect(display.items().filter((item) => item.kind === "reviewResult" && item.reviewKind === "automaticResult")).toMatchObject([
      { executionState: "running", review: { auditFacts: expect.arrayContaining([{ key: "status", value: "inProgress" }]) } },
    ]);
    display.warning(commandWarning);
    const originalNotifications = display.items().filter((item) => item.kind === "reviewResult" && item.reviewKind === "message");
    expect(display.render()).toEqual([
      "Auto-review approved: Spawning the requested scout is allowed.",
      "Auto-review started: npm test",
      "Auto-review approved: Running the requested test suite is allowed.",
    ]);

    display.send(completed);
    expect(display.items().filter((item) => item.kind === "reviewResult" && item.reviewKind === "automaticResult")).toMatchObject([
      { executionState: "completed", review: { auditFacts: expect.arrayContaining([{ key: "status", value: "approved" }]) } },
    ]);
    expect(display.render()).toEqual(["Auto-review approved: Spawning the requested scout is allowed.", "Auto-review approved: npm test"]);
    expect(display.items()).toEqual(expect.arrayContaining(originalNotifications));
    expect(display.items()).toHaveLength(3);
    display.render(true);
    expect(notificationBodies(display.parent)).toEqual([nativeWarning, commandWarning]);
    expect(textContents(display.parent, ".codex-panel__output-title")).toContain("Notification with matching assessment");
    expect(textContents(display.parent, "dd")).toEqual(
      expect.arrayContaining(["npm test", "low", "high", "Running the requested test suite is allowed."]),
    );

    display.send({
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: appServerTurnFixture({
          id: "turn",
          status: "completed",
          itemsView: "full",
          items: [appServerUserMessageFixture("user", "Run tests"), appServerAgentMessageFixture("answer", "Tests passed.")],
        }),
      },
    });
    display.render();
    expect(display.parent.querySelector<HTMLDetailsElement>(".codex-panel__activity-group")?.open).toBe(false);
    expect(display.parent.querySelector(".codex-panel__auto-reviews summary")?.textContent).toBe("Auto-reviewed 1 request");
    display.render(true);
    expect(display.parent.querySelector<HTMLDetailsElement>(".codex-panel__activity-group")?.open).toBe(true);
    expect(
      [...display.parent.querySelectorAll<HTMLDetailsElement>(".codex-panel__detail-disclosure")].map((details) => details.open),
    ).toEqual([true, true]);
    expect(notificationBodies(display.parent)).toEqual([nativeWarning, commandWarning]);
    expect(display.items()).toEqual(expect.arrayContaining(originalNotifications));
  });

  it("keeps repeated equal warnings as separate observations", () => {
    const display = reviewDisplay();
    display.start();
    display.send(completedReview());
    display.warning(commandWarning);
    expect(display.render()).toEqual(["Auto-review approved: npm test"]);

    display.warning(commandWarning);
    expect(display.items()).toHaveLength(3);
    expect(display.render()).toEqual([
      "Auto-review approved: npm test",
      "Auto-review approved: Running the requested test suite is allowed.",
      "Auto-review approved: Running the requested test suite is allowed.",
    ]);
    expect(notificationBodies(display.parent)).toEqual([commandWarning, commandWarning]);
  });

  it("keeps competing equal reviews separate", () => {
    const display = reviewDisplay();
    display.start();
    display.warning(commandWarning);
    display.send(completedReview());
    display.send(
      completedReview({ reviewId: "review-2", action: { type: "command", source: "shell", command: "npm run check", cwd: "/vault" } }),
    );
    expect(display.render()).toEqual([
      "Auto-review approved: Running the requested test suite is allowed.",
      "Auto-review approved: npm test",
      "Auto-review approved: npm run check",
    ]);
    expect(notificationBodies(display.parent)).toEqual([commandWarning]);
  });

  it("compacts distinct complete assessments independently in one turn", () => {
    const display = reviewDisplay();
    display.start();
    display.warning(commandWarning);
    display.send(completedReview());
    const denied = "Automatic approval review denied (risk: high, authorization: low): The requested check would modify unrelated files.";
    display.warning(denied);
    display.send(
      completedReview({
        reviewId: "review-2",
        action: { type: "command", source: "shell", command: "npm run check", cwd: "/vault" },
        review: {
          status: "denied",
          riskLevel: "high",
          userAuthorization: "low",
          rationale: "The requested check would modify unrelated files.",
        },
      }),
    );
    expect(display.render()).toEqual(["Auto-review approved: npm test", "Auto-review denied: npm run check"]);
    expect(notificationBodies(display.parent)).toEqual([commandWarning, denied]);
    expect(display.items()).toHaveLength(4);
  });

  it.each([
    {
      name: "multiline rationale",
      rationale: "First line.\nKeep the complete second line.  ",
      warning: "Automatic approval review approved (risk: low, authorization: high): First line.\nKeep the complete second line.  ",
      rows: 1,
    },
    { name: "empty rationale", rationale: "", warning: "Automatic approval review approved (risk: low, authorization: high): ", rows: 1 },
    {
      name: "unknown warning field",
      rationale: "Allowed.",
      warning: "Automatic approval review approved (risk: low, authorization: high, caveat: keep a backup): Allowed.",
      rows: 2,
    },
    {
      name: "different authorization",
      rationale: "Allowed.",
      warning: "Automatic approval review approved (risk: low, authorization: medium): Allowed.",
      rows: 2,
    },
    {
      name: "different risk",
      rationale: "Allowed.",
      warning: "Automatic approval review approved (risk: medium, authorization: high): Allowed.",
      rows: 2,
    },
    {
      name: "different decision",
      rationale: "Allowed.",
      warning: "Automatic approval review denied (risk: low, authorization: high): Allowed.",
      rows: 2,
    },
    {
      name: "warning-only rationale suffix",
      rationale: "Allowed.",
      warning: "Automatic approval review approved (risk: low, authorization: high): Allowed. Keep a backup.",
      rows: 2,
    },
  ])("preserves the entire notification with $name", ({ rationale, warning, rows }) => {
    const display = reviewDisplay();
    display.start();
    display.warning(warning);
    display.send(completedReview({ review: { status: "approved", riskLevel: "low", userAuthorization: "high", rationale } }));
    expect(display.render(true)).toHaveLength(rows);
    expect(notificationBodies(display.parent)).toEqual([warning]);
    expect(display.items()).toHaveLength(2);
    expect(display.items()[0]).toMatchObject({ review: { originalMessage: warning } });
  });

  it("keeps matching unscoped and earlier-turn warnings separate", () => {
    const display = reviewDisplay();
    display.warning(commandWarning);
    display.start("previous");
    display.warning(commandWarning);
    display.send({
      method: "turn/completed",
      params: { threadId: "thread", turn: appServerTurnFixture({ id: "previous", status: "completed", itemsView: "full", items: [] }) },
    });
    display.start();
    display.send(completedReview());
    expect(display.render()).toHaveLength(3);
    expect(notificationBodies(display.parent)).toEqual([commandWarning, commandWarning]);
    expect(display.items().map((item) => item.turnId)).toEqual([undefined, "previous", "turn"]);
  });

  it.each(["timedOut", "aborted", "denied"] as const)("retains failed or incomplete review notifications: %s", (status) => {
    const display = reviewDisplay();
    display.start();
    const failureMessages = {
      timedOut: "Automatic approval review timed out while evaluating the requested approval.",
      aborted: "Automatic approval review failed: the complete action and minimum review context exceed the reviewer input budget",
      denied: "Automatic approval review failed: authorization changed before approval could be applied",
    };
    const message = failureMessages[status];
    display.warning(message);
    display.send(completedReview({ review: { status, riskLevel: null, userAuthorization: null, rationale: message } }));
    expect(display.render(true)).toHaveLength(2);
    expect(notificationBodies(display.parent)).toEqual([message]);
  });

  it("retains the circuit-breaker notification while presenting one visible terminal failure", () => {
    const display = reviewDisplay();
    display.start();
    const message =
      "Automatic approval review rejected too many approval requests for this turn (3 consecutive, 3 in the last 5 reviews); interrupting the turn.";
    display.warning(message);
    const notification = display.items()[0];
    display.send({
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: appServerTurnFixture({
          id: "turn",
          status: "interrupted",
          itemsView: "full",
          items: [appServerAgentMessageFixture("answer", "Stopping.")],
          error: { message, codexErrorInfo: "tooManyDenials", additionalDetails: null, misalignment: null },
        }),
      },
    });
    expect(display.items()).toEqual(expect.arrayContaining([notification]));
    expect(display.items().filter((item) => item.kind === "reviewResult")).toHaveLength(2);
    expect(display.render(true)).toEqual([message]);
    const terminal = display.parent.querySelector(".codex-panel__stream-item--review-result");
    expect(terminal?.classList.contains("codex-panel__execution--failed")).toBe(true);
    expect(terminal?.closest(".codex-panel__activity-group")).toBeNull();
    expect(notificationBodies(display.parent)).toEqual([message]);
  });
  it.each([
    {
      name: "additional terminal diagnosis",
      message: "Guardian stopped this turn.",
      additionalDetails: "Review service failed independently.",
    },
    { name: "different terminal reason", message: "A different terminal error.", additionalDetails: null },
  ])("does not fold a warning into a terminal error with $name", ({ message, additionalDetails }) => {
    const display = reviewDisplay();
    display.start();
    display.warning("Guardian stopped this turn.");
    display.send({
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: appServerTurnFixture({
          id: "turn",
          status: "interrupted",
          itemsView: "full",
          items: [],
          error: { message, codexErrorInfo: "tooManyDenials", additionalDetails, misalignment: null },
        }),
      },
    });
    display.render(true);
    expect(display.items()).toHaveLength(2);
    expect(display.parent.querySelectorAll("[data-codex-panel-block-key]")).toHaveLength(2);
    expect(notificationBodies(display.parent)).toContain("Guardian stopped this turn.");
    expect(display.parent.textContent).toContain(additionalDetails ?? message);
  });
});
