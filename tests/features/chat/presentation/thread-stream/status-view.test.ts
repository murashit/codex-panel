import { describe, expect, it } from "vitest";
import { agentRunSummaryView } from "../../../../../src/features/chat/presentation/thread-stream/status-view";

describe("agent run summary view", () => {
  it("uses the activity preview without repeating the running status", () => {
    const view = agentRunSummaryView({
      running: 1,
      completed: 0,
      failed: 0,
      agents: [
        {
          threadId: "019agent",
          status: "running",
          messagePreview: "Inspecting notification routing",
        },
      ],
      additionalAgents: 0,
    });

    expect(view.rows).toEqual([
      {
        threadId: "019agent",
        threadLabel: "019agent",
        status: "Inspecting notification routing",
      },
    ]);
  });
});
