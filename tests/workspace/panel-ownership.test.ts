import { describe, expect, it } from "vitest";
import { duplicatePanels } from "../../src/workspace/panel-ownership";

describe("panel ownership", () => {
  it.each([
    { name: "attached over restored", modes: ["restored", "attached"], duplicate: 0 },
    { name: "active over attached", modes: ["attached", "active"], duplicate: 0 },
    { name: "first attached", modes: ["attached", "attached"], duplicate: 1 },
    { name: "first restored", modes: ["restored", "restored"], duplicate: 1 },
  ])("prefers $name without changing input order", ({ modes, duplicate }) => {
    const panels = modes.map((mode) => Object.freeze({ threadId: "same", attached: mode !== "restored", active: mode === "active" }));
    const input = Object.freeze(panels);
    expect([...duplicatePanels(input)].map((panel) => input.indexOf(panel))).toEqual([duplicate]);
  });

  it("retains independent threads and every unassigned draft", () => {
    const panels = ["one", "two", null, null].map((threadId) => ({ threadId, attached: true, active: false }));
    expect(duplicatePanels(panels).size).toBe(0);
  });
});
