import { describe, expect, it } from "vitest";
import {
  type AgentCoordinationLifecycle,
  applyAgentCoordinationUpdate,
} from "../../../../../src/features/chat/domain/thread-stream/agent-coordination";

describe("agent coordination lifecycle", () => {
  it.each([
    {
      name: "starts an unknown agent",
      lifecycle: { liveness: "unknown", outcome: null },
      update: "started",
      expected: { liveness: "running", outcome: null },
    },
    {
      name: "leaves lifecycle unchanged on interaction",
      lifecycle: { liveness: "running", outcome: null },
      update: "interacted",
      expected: { liveness: "running", outcome: null },
    },
    {
      name: "stops a running agent on interruption",
      lifecycle: { liveness: "running", outcome: null },
      update: "interrupted",
      expected: { liveness: "stopped", outcome: null },
    },
    {
      name: "preserves a completed outcome on interruption",
      lifecycle: { liveness: "stopped", outcome: "completed" },
      update: "interrupted",
      expected: { liveness: "stopped", outcome: "completed" },
    },
    {
      name: "does not revive a stopped agent on delayed start",
      lifecycle: { liveness: "stopped", outcome: null },
      update: "started",
      expected: { liveness: "stopped", outcome: null },
    },
  ] as const)("$name", ({ lifecycle, update, expected }) => {
    expect(applyAgentCoordinationUpdate(lifecycle satisfies AgentCoordinationLifecycle, update)).toEqual(expected);
  });
});
