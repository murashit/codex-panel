import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sourceDir = path.join("src", "styles");
const sourceFiles = JSON.parse(readFileSync(path.join(sourceDir, "order.json"), "utf8")) as string[];
const styles = `${sourceFiles.map((file) => readFileSync(path.join(sourceDir, file), "utf8").trimEnd()).join("\n\n")}\n`;

describe("panel CSS token scope", () => {
  it("defines design tokens on every standalone UI root", () => {
    const tokenScope = /^(?<selectors>(?:\.[^{]+,\n)*\.[^{]+) \{/m.exec(styles)?.groups?.["selectors"] ?? "";

    expect(tokenScope).toContain(".codex-panel");
    expect(tokenScope).toContain(".codex-panel-chat-turn-diff");
    expect(tokenScope).toContain(".codex-panel-settings");
    expect(tokenScope).toContain(".codex-panel-threads");
    expect(tokenScope).toContain(".codex-panel-selection-rewrite");
  });
});

describe("chat toolbar CSS", () => {
  it("keeps mouse-focus reset less specific than active toolbar controls", () => {
    const toolbarMouseFocus =
      /\.codex-panel-ui__toolbar-control:where\(:focus:not\(:hover\):not\(:focus-visible\)\) \{(?<body>[^}]+)\}/.exec(styles)?.groups?.[
        "body"
      ] ?? "";

    expect(toolbarMouseFocus).toContain("background: transparent");
    expect(toolbarMouseFocus).toContain("color: var(--icon-color)");
  });

  it("keeps class selectors out of zero-specificity :where selectors", () => {
    expect(styles).not.toMatch(/:where\([^)]*[.#[]/);
  });

  it("keeps selected toolbar rows stable while hovered", () => {
    const selectedToolbarHover =
      /\.codex-panel__toolbar-panel-item\.is-selected:where\(:hover, :focus, :focus-visible, :active\):not\(:disabled\):not\(\.is-disabled\) \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";
    const selectedThreadHover =
      /\.codex-panel__thread-row--selected:hover,\n\.codex-panel__thread-row--selected:focus-within \{(?<body>[^}]+)\}/.exec(styles)
        ?.groups?.["body"] ?? "";

    expect(selectedToolbarHover).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedThreadHover).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedToolbarHover).not.toContain("nav-item-background-active-hover");
    expect(selectedThreadHover).not.toContain("nav-item-background-active-hover");
  });
});

describe("chat message CSS", () => {
  it("uses a pointer cursor for the inline turn diff action", () => {
    const openTurnDiff = /\.codex-panel__open-turn-diff \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(openTurnDiff).toContain("cursor: pointer");
  });
});

describe("threads view CSS", () => {
  it("keeps long row titles clear of trailing actions", () => {
    const list = /\.codex-panel-threads__list \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const titleLine = /\.codex-panel-threads__row-title-line \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const title = /(?:^|\n\n)\.codex-panel-threads__row-title \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(styles).toContain("--codex-panel-threads-row-actions-width");
    expect(list).toContain("gap: var(--nav-item-margin-bottom, var(--codex-panel-panel-gap))");
    expect(titleLine).toContain("box-sizing: border-box");
    expect(titleLine).toContain("padding-right: calc(var(--codex-panel-threads-row-actions-width) + var(--codex-panel-item-gap));");
    expect(title).toContain("display: block");
  });

  it("keeps toolbar hover color separate from row action hover color", () => {
    const toolbarButton = /\.codex-panel-threads__toolbar-button \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const toolbarHover =
      /\.codex-panel-threads__toolbar-button:hover,\n\.codex-panel-threads__toolbar-button:focus-visible \{(?<body>[^}]+)\}/.exec(styles)
        ?.groups?.["body"] ?? "";
    const toolbarMouseFocus =
      /\.codex-panel-threads__toolbar-button:focus:not\(:hover\):not\(:focus-visible\) \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ??
      "";
    const rowHover =
      /\.codex-panel-threads__row-button:hover,\n\.codex-panel-threads__row-button:focus,\n\.codex-panel-threads__row-button:focus-visible,\n\.codex-panel-threads__row-button:active \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";

    expect(styles).not.toContain(".codex-panel-threads__toolbar-actions {");
    expect(styles).toContain("--codex-panel-size-clickable-icon");
    expect(toolbarButton).toContain("width: var(--codex-panel-size-clickable-icon)");
    expect(toolbarButton).toContain("height: var(--codex-panel-size-clickable-icon)");
    expect(toolbarButton).toContain("padding: var(--clickable-icon-padding, var(--codex-panel-control-gap))");
    expect(toolbarHover).toContain("background: var(--background-modifier-hover)");
    expect(toolbarHover).toContain("color: var(--icon-color)");
    expect(toolbarHover).not.toContain("var(--icon-color-active)");
    expect(toolbarMouseFocus).toContain("background: transparent");
    expect(toolbarMouseFocus).toContain("color: var(--icon-color)");
    expect(rowHover).toContain("color: var(--icon-color-active)");
  });

  it("keeps selected thread rows stable while hovered", () => {
    const selectedRowHover =
      /\.codex-panel-threads__row--selected:hover,\n\.codex-panel-threads__row--selected:focus-within \{(?<body>[^}]+)\}/.exec(styles)
        ?.groups?.["body"] ?? "";

    expect(selectedRowHover).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedRowHover).not.toContain("nav-item-background-active-hover");
  });
});
