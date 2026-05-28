import { describe, expect, it } from "vitest";

import {
  createStructuredTurnRunLifecycle,
  structuredTurnRunMatches,
  transitionStructuredTurnRunLifecycle,
} from "../../src/app-server/structured-turn-run-lifecycle";

describe("structured turn run lifecycle", () => {
  it("tracks the active thread before the turn id is acknowledged", () => {
    const threadStarted = transitionStructuredTurnRunLifecycle(createStructuredTurnRunLifecycle(), {
      type: "thread-started",
      threadId: "thread",
    });

    expect(structuredTurnRunMatches(threadStarted, "thread", "early-turn")).toBe(true);
    expect(structuredTurnRunMatches(threadStarted, "other-thread", "early-turn")).toBe(false);
  });

  it("narrows notifications to the acknowledged turn and keeps completed terminal", () => {
    const threadStarted = transitionStructuredTurnRunLifecycle(createStructuredTurnRunLifecycle(), {
      type: "thread-started",
      threadId: "thread",
    });
    const turnStarted = transitionStructuredTurnRunLifecycle(threadStarted, {
      type: "turn-started",
      threadId: "thread",
      turnId: "turn",
    });
    const completed = transitionStructuredTurnRunLifecycle(turnStarted, { type: "completed" });

    expect(structuredTurnRunMatches(turnStarted, "thread", "turn")).toBe(true);
    expect(structuredTurnRunMatches(turnStarted, "thread", "other-turn")).toBe(false);
    expect(transitionStructuredTurnRunLifecycle(completed, { type: "thread-started", threadId: "late" })).toBe(completed);
  });
});
