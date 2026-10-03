import * as fc from "fast-check";
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

  it("retains one preferred owner per thread and every unassigned draft", () => {
    const panel = fc.record({
      threadId: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
      mode: fc.constantFrom("restored", "attached", "active"),
    });
    fc.assert(
      fc.property(fc.array(panel, { maxLength: 30 }), (specs) => {
        const activeIndex = specs.findIndex(({ mode }) => mode === "active");
        const input = Object.freeze(
          specs.map(({ threadId, mode }, index) =>
            Object.freeze({
              threadId: threadId === null ? null : String(threadId),
              attached: mode !== "restored",
              active: index === activeIndex,
            }),
          ),
        );
        const duplicates = duplicatePanels(input);
        const retained = input.filter((entry) => !duplicates.has(entry));
        for (const entry of input) {
          if (entry.threadId === null) {
            expect(retained).toContain(entry);
            continue;
          }
          const group = input.filter((candidate) => candidate.threadId === entry.threadId);
          const owner = group.find((candidate) => candidate.active) ?? group.find((candidate) => candidate.attached) ?? group[0];
          expect(retained.filter((candidate) => candidate.threadId === entry.threadId)).toEqual([owner]);
        }
        expect([...duplicates].every((entry) => input.includes(entry))).toBe(true);
        expect(duplicatePanels(retained).size).toBe(0);
      }),
      {
        examples: [
          [
            [
              { threadId: 0, mode: "attached" },
              { threadId: 1, mode: "attached" },
              { threadId: null, mode: "attached" },
              { threadId: null, mode: "attached" },
            ],
          ],
        ],
      },
    );
  });
});
