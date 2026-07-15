import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sourceDir = path.join("src", "styles");
const sourceFiles = JSON.parse(readFileSync(path.join(sourceDir, "order.json"), "utf8")) as string[];
const styles = `${sourceFiles.map((file) => readFileSync(path.join(sourceDir, file), "utf8").trimEnd()).join("\n\n")}\n`;

function ruleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escapedSelector} \\{(?<body>[^}]+)\\}`).exec(styles)?.groups?.["body"] ?? "";
}

function standaloneRuleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n\\n)${escapedSelector} \\{(?<body>[^}]+)\\}`).exec(styles)?.groups?.["body"] ?? "";
}

describe("panel CSS boundaries", () => {
  it("defines design tokens on every standalone UI root", () => {
    const tokenScopeEnd = styles.indexOf(" {");
    expect(tokenScopeEnd).toBeGreaterThan(0);
    const tokenScope = styles.slice(0, tokenScopeEnd);

    expect(tokenScope).toContain(".codex-panel");
    expect(tokenScope).toContain(".codex-panel-turn-diff");
    expect(tokenScope).toContain(".codex-panel-settings");
    expect(tokenScope).toContain(".codex-panel-threads");
    expect(tokenScope).toContain(".codex-panel-selection-rewrite");
  });

  it("keeps selectors shallow enough for Obsidian theme compatibility", () => {
    expect(styles).not.toContain(":has(");
    expect(styles).not.toMatch(/:where\([^)]*[.#[]/);
    expect(styles).not.toMatch(/(^|[\s,{])#[\w-]+/);
  });
});

describe("panel CSS layout invariants", () => {
  it("lets the thread stream scroll inside the shell grid", () => {
    const threadStream = ruleBody(".codex-panel__thread-stream");

    expect(threadStream).toContain("overflow-y: auto");
    expect(threadStream).not.toMatch(/^\s+height:/m);
  });

  it("keeps icon-only toolbar actions on Obsidian toolbar geometry", () => {
    const toolbar = ruleBody(".codex-panel__toolbar");
    const toolbarAction = ruleBody(".codex-panel-ui__toolbar-action");

    expect(toolbarAction).toContain("--icon-size: var(--codex-panel-control-icon-size)");
    expect(toolbarAction).toContain("--icon-stroke: var(--icon-m-stroke-width, 1.75px)");
    expect(toolbarAction).not.toContain("width:");
    expect(toolbarAction).not.toContain("height:");
    expect(toolbarAction).not.toContain("padding:");
    expect(toolbarAction).not.toContain("border-radius:");
    expect(toolbar).not.toContain("padding:");
  });

  it("keeps shared nav rows aligned with Obsidian nav item geometry", () => {
    const navItem = ruleBody(".codex-panel-ui__nav-item");
    const navRow = ruleBody(".codex-panel-ui__nav-row");

    expect(navItem).toContain("min-height: var(--nav-item-size");
    expect(navItem).toContain("padding: var(--nav-item-padding");
    expect(navItem).toContain("border-radius: var(--nav-item-radius");
    expect(navRow).toContain("padding-inline-end:");
  });

  it("keeps selected nav items stable when hovered or focused", () => {
    const selectedNavItem = ruleBody(".codex-panel-ui__nav-item.is-selected:where(:hover, :focus, :focus-visible, :active, :focus-within)");
    const selectedNavRow = ruleBody(
      [
        ".codex-panel-ui__nav-row.is-selected,",
        ".codex-panel-ui__nav-row.is-selected:hover,",
        ".codex-panel-ui__nav-row.is-selected:focus-within",
      ].join("\n"),
    );

    expect(selectedNavItem).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedNavRow).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedNavItem).not.toContain("nav-item-background-active-hover");
    expect(selectedNavRow).not.toContain("nav-item-background-active-hover");
  });

  it("keeps nav inline inputs as native inline editors", () => {
    const navInlineInput = ruleBody(".codex-panel-ui__nav-inline-input.codex-panel-ui__nav-inline-input");
    const navInlineInputFocus = ruleBody(
      [
        ".codex-panel-ui__nav-inline-input.codex-panel-ui__nav-inline-input:focus,",
        ".codex-panel-ui__nav-inline-input.codex-panel-ui__nav-inline-input:focus-visible,",
        ".codex-panel-ui__nav-inline-input.codex-panel-ui__nav-inline-input:hover,",
        ".codex-panel-ui__nav-inline-input.codex-panel-ui__nav-inline-input:active",
      ].join("\n"),
    );

    expect(navInlineInput).toContain("appearance: none");
    expect(navInlineInput).toContain("border: 0");
    expect(navInlineInput).toContain("background: transparent");
    expect(navInlineInputFocus).toContain("background: transparent");
  });

  it("keeps framed text inputs native across panel surfaces", () => {
    const frame = ruleBody(".codex-panel-ui__text-input-frame");
    const frameFocus = ruleBody(".codex-panel-ui__text-input-frame:focus-within");
    const input = ruleBody(".codex-panel-ui__text-input");
    const inputInteraction = ruleBody(
      [
        ".codex-panel-ui__text-input.codex-panel-ui__text-input:hover,",
        ".codex-panel-ui__text-input.codex-panel-ui__text-input:focus,",
        ".codex-panel-ui__text-input.codex-panel-ui__text-input:focus-visible,",
        ".codex-panel-ui__text-input.codex-panel-ui__text-input:active",
      ].join("\n"),
    );

    expect(frame).toContain("background: var(--background-modifier-form-field)");
    expect(frameFocus).toContain("border-color: var(--background-modifier-border-focus)");
    expect(input).toContain("border: 0");
    expect(inputInteraction).toContain("background: transparent");
    expect(inputInteraction).toContain("outline: none");
  });

  it("shares activity dot timing across active surfaces", () => {
    const activityDots = ruleBody(".codex-panel-ui__activity-dots span");
    const secondDot = ruleBody(".codex-panel-ui__activity-dots span:where(:nth-child(2))");
    const thirdDot = ruleBody(".codex-panel-ui__activity-dots span:where(:nth-child(3))");

    expect(activityDots).toContain("animation: codex-panel-activity-dot 1.2s infinite ease-in-out");
    expect(secondDot).toContain("animation-delay: 0.18s");
    expect(thirdDot).toContain("animation-delay: 0.36s");
  });

  it("keeps compact status rows from wrapping or stealing pointer interaction", () => {
    const contextMeter = ruleBody(".codex-panel__composer-meta-context");
    const summary = ruleBody(".codex-panel__composer-meta-summary");

    expect(contextMeter).toContain("white-space: nowrap");
    expect(contextMeter).toContain("font-variant-numeric: tabular-nums");
    expect(summary).toContain("position: absolute");
    expect(summary).toContain("pointer-events: none");
  });

  it("lets usage limit meters absorb available width", () => {
    const limitMeterCell = ruleBody(".codex-panel__limit-panel-meter-cell");
    const limitValue = ruleBody(".codex-panel__limit-panel-value");
    const limitReset = standaloneRuleBody(".codex-panel__limit-panel-reset");

    expect(limitMeterCell).toContain("width: 100%");
    expect(limitMeterCell).toContain("vertical-align: middle");
    expect(limitValue).toContain("font-variant-numeric: tabular-nums");
    expect(limitReset).toContain("white-space: nowrap");
  });

  it("keeps threads view row titles ellipsized while actions stay collapsed until interaction", () => {
    const rowTitleBase = ruleBody(".codex-panel-threads__row-title");
    const rowTitleDisplay = standaloneRuleBody(".codex-panel-threads__row-title");
    const actions = ruleBody(".codex-panel-threads__actions");
    const actionReveal = ruleBody(
      [
        ".codex-panel-threads__row:hover .codex-panel-threads__actions,",
        ".codex-panel-threads__row:focus-within .codex-panel-threads__actions",
      ].join("\n"),
    );

    expect(rowTitleDisplay).toContain("display: block");
    expect(rowTitleBase).toContain("white-space: nowrap");
    expect(rowTitleBase).toContain("text-overflow: ellipsis");
    expect(actions).toContain("width: 0");
    expect(actions).toContain("pointer-events: none");
    expect(actions).toContain("opacity: 0");
    expect(actionReveal).toContain("width: auto");
    expect(actionReveal).toContain("pointer-events: auto");
    expect(actionReveal).toContain("opacity: 1");
  });

  it("keeps threads view inline rename aligned to nav row height", () => {
    const renameForm = ruleBody(".codex-panel-threads__rename-form");
    const renameField = ruleBody(".codex-panel-threads__rename-field");
    const renameInput = ruleBody(".codex-panel-threads__rename-input");

    expect(renameForm).toContain("min-height: var(--nav-item-size");
    expect(renameField).toContain("min-height: var(--nav-item-size");
    expect(renameInput).toContain("line-height: var(--line-height-tight)");
  });

  it("keeps selection rewrite controls framed as a compact edit-and-review surface", () => {
    const composerFrame = ruleBody(".codex-panel-selection-rewrite__composer-frame");
    const sharedFrame = ruleBody(".codex-panel-ui__text-input-frame");
    const result = ruleBody(".codex-panel-selection-rewrite__result");

    expect(composerFrame).toContain("grid-template-columns:");
    expect(sharedFrame).toContain("background: var(--background-modifier-form-field)");
    expect(result).toContain("grid-template-columns:");
    expect(result).toContain("border: var(--codex-panel-border)");
  });
});
