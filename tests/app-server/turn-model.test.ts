import { describe, expect, it } from "vitest";

import { lastAgentMessageTextFromAppServerTurn } from "../../src/app-server/turn-model";
import type { ThreadItem } from "../../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../../src/generated/app-server/v2/Turn";

describe("app-server turn model", () => {
  it("extracts the final non-empty agent message text from a turn", () => {
    expect(
      lastAgentMessageTextFromAppServerTurn(
        turn([
          agentMessage("a1", '{"replacementText":"first"}'),
          agentMessage("a2", "  "),
          agentMessage("a3", '{"replacementText":"final"}'),
        ]),
      ),
    ).toBe('{"replacementText":"final"}');
  });

  it("returns null when a turn has no agent message text", () => {
    expect(lastAgentMessageTextFromAppServerTurn(turn([agentMessage("a1", "  ")]))).toBeNull();
  });
});

function turn(items: Turn["items"]): Turn {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
}

function agentMessage(id: string, text: string): ThreadItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}
