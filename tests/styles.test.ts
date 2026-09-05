// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const sourceDir = path.join("src", "styles");
const sourceFiles = JSON.parse(readFileSync(path.join(sourceDir, "order.json"), "utf8")) as string[];
const style = document.createElement("style");
style.textContent = sourceFiles.map((file) => readFileSync(path.join(sourceDir, file), "utf8")).join("\n");
document.head.append(style);
afterAll(() => style.remove());

// These guard authored CSS declarations, not rendered geometry or the host theme's cascade.
function declarations(selector: string): CSSStyleDeclaration {
  const rules = Array.from(style.sheet?.cssRules ?? []).filter(
    (rule): rule is CSSStyleRule =>
      "selectorText" in rule && (rule as CSSStyleRule).selectorText.split(",").some((part) => part.trim() === selector),
  );
  if (rules.length === 0) throw new Error(`Missing CSS selector: ${selector}`);
  const result = document.createElement("div").style;
  for (const rule of rules) {
    for (let index = 0; index < rule.style.length; index += 1) {
      const property = rule.style.item(index);
      result.setProperty(property, rule.style.getPropertyValue(property));
    }
  }
  return result;
}

function expectExposedActions(selector: string): void {
  const actions = declarations(selector);
  expect(actions.getPropertyValue("width")).toBe("auto");
  expect(actions.getPropertyValue("overflow")).toBe("visible");
  expect(actions.getPropertyValue("opacity")).toBe("1");
}

describe("panel CSS declaration contracts", () => {
  it("uses the host selection color for retained editor selections", () => {
    expect(declarations(".codex-panel-selection-emphasis").getPropertyValue("background-color")).toBe("var(--text-selection)");
  });

  it.each([".codex-panel", ".codex-panel-turn-diff", ".codex-panel-settings", ".codex-panel-threads", ".codex-panel-selection-rewrite"])(
    "provides shared theme and spacing tokens directly on standalone %s",
    (root) => {
      const tokens = declarations(root);
      expect(tokens.getPropertyValue("--codex-panel-text-normal")).toBe("var(--text-normal)");
      expect(tokens.getPropertyValue("--codex-panel-control-gap")).toContain("var(--size-2-2,");
    },
  );

  it("allows the transcript to shrink and scroll within its shell region", () => {
    const stream = declarations(".codex-panel__thread-stream");
    expect(stream.getPropertyValue("overflow-y")).toBe("auto");
    expect(stream.getPropertyValue("min-height")).toBe("0px");
    expect(declarations(".codex-panel__region--thread-stream").getPropertyValue("min-height")).toBe("0px");
  });

  it.each([
    { row: ".codex-panel__thread-row", actions: ".codex-panel__thread-actions", action: ".codex-panel__thread-action" },
    { row: ".codex-panel-threads__row", actions: ".codex-panel-threads__actions", action: null },
  ])("releases collapsed action styles on hover and keyboard focus for $row", ({ row, actions, action }) => {
    for (const state of [":hover", ":focus-within"]) {
      // The current grid implementation collapses this track at rest; interactive states must release it.
      expect(declarations(`${row}${state}`).getPropertyValue("grid-template-columns")).toBe("minmax(0, 1fr) auto");
      expectExposedActions(`${row}${state} ${actions}`);
      expect(declarations(`${row}${state} ${actions}`).getPropertyValue("pointer-events")).toBe("auto");
      if (action) expectExposedActions(`${row}${state} ${action}`);
    }
  });

  it("releases rename actions without requiring hover or focus in Threads", () => {
    expect(declarations(".codex-panel-threads__row--renaming").getPropertyValue("grid-template-columns")).toBe("minmax(0, 1fr) auto");
    expectExposedActions(".codex-panel-threads__rename-actions");
    expect(declarations(".codex-panel-threads__rename-actions").getPropertyValue("pointer-events")).toBe("auto");
  });

  it("releases auto-name cancellation without requiring hover or focus in the toolbar", () => {
    const row = ".codex-panel__thread-row--auto-name-running";
    expect(declarations(row).getPropertyValue("grid-template-columns")).toBe("minmax(0, 1fr) auto");
    expectExposedActions(`${row} .codex-panel__thread-action`);
  });

  it.each([
    { row: ".codex-panel__thread-row--archive-confirming", actions: ".codex-panel__thread-actions", action: ".codex-panel__thread-action" },
    { row: ".codex-panel-threads__row--archive-confirming", actions: ".codex-panel-threads__actions", action: null },
  ])("releases archive confirmation controls without hover or focus for $row", ({ row, actions, action }) => {
    expect(declarations(row).getPropertyValue("grid-template-columns")).toBe("minmax(0, 1fr) auto");
    expectExposedActions(`${row} ${actions}`);
    expect(declarations(`${row} ${actions}`).getPropertyValue("pointer-events")).toBe("auto");
    if (action) expectExposedActions(`${row} ${action}`);
  });
});
