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
  it("lets icon-only toolbar actions use Obsidian nav action geometry", () => {
    const toolbarAction = /\.codex-panel-ui__toolbar-action \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const toolbar = /\.codex-panel__toolbar \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(toolbarAction).toContain("--icon-size: var(--codex-panel-control-icon-size)");
    expect(toolbarAction).toContain("--icon-stroke: var(--icon-m-stroke-width, 1.75px)");
    expect(toolbarAction).not.toContain("width:");
    expect(toolbarAction).not.toContain("height:");
    expect(toolbarAction).not.toContain("padding:");
    expect(toolbarAction).not.toContain("border-radius:");
    expect(toolbar).not.toContain("padding:");
    expect(styles).not.toContain(".codex-panel__runtime-area");
    expect(styles).not.toContain(".codex-panel__runtime-strip");
  });

  it("keeps mouse-focus reset less specific than active toolbar controls", () => {
    const toolbarMouseFocus =
      /\.codex-panel-ui__toolbar-control:where\(:focus:not\(:hover\):not\(:focus-visible\)\) \{(?<body>[^}]+)\}/.exec(styles)?.groups?.[
        "body"
      ] ?? "";
    const toolbarActionMouseFocus =
      /\.codex-panel-ui__toolbar-action:where\(:focus:not\(:hover\):not\(:focus-visible\)\) \{(?<body>[^}]+)\}/.exec(styles)?.groups?.[
        "body"
      ] ?? "";

    expect(toolbarMouseFocus).toContain("background: transparent");
    expect(toolbarMouseFocus).toContain("color: var(--icon-color)");
    expect(toolbarActionMouseFocus).toContain("background: transparent");
    expect(toolbarActionMouseFocus).toContain("color: var(--icon-color)");
  });

  it("uses the shared active state for toolbar actions", () => {
    const toolbarControlActive =
      /\.codex-panel-ui__toolbar-control\.is-active,\n\.codex-panel-ui__toolbar-control\.is-active:hover,\n\.codex-panel-ui__toolbar-control\.is-active:focus-visible,\n\.codex-panel-ui__toolbar-control\.is-active:active \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";
    const toolbarActionActive =
      /\.codex-panel-ui__toolbar-action\.is-active,\n\.codex-panel-ui__toolbar-action\.is-active:hover,\n\.codex-panel-ui__toolbar-action\.is-active:focus-visible,\n\.codex-panel-ui__toolbar-action\.is-active:active \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";

    expect(toolbarControlActive).toContain("background: var(--background-modifier-active-hover)");
    expect(toolbarControlActive).toContain("color: var(--icon-color-active)");
    expect(toolbarActionActive).toContain("background: var(--background-modifier-active-hover)");
    expect(toolbarActionActive).toContain("color: var(--icon-color-active)");
    expect(styles).not.toContain(".codex-panel__runtime-model.is-active");
    expect(styles).not.toContain(".codex-panel__runtime-model-value");
  });

  it("keeps class selectors out of zero-specificity :where selectors", () => {
    expect(styles).not.toMatch(/:where\([^)]*[.#[]/);
  });

  it("keeps selected toolbar rows stable while hovered", () => {
    const navItem = /\.codex-panel-ui__nav-item \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const selectedNavItem =
      /\.codex-panel-ui__nav-item\.is-selected:where\(:hover, :focus, :focus-visible, :active, :focus-within\) \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";
    const selectedNavRow =
      /\.codex-panel-ui__nav-row\.is-selected,\n\.codex-panel-ui__nav-row\.is-selected:hover,\n\.codex-panel-ui__nav-row\.is-selected:focus-within \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";

    expect(navItem).toContain("min-height: var(--nav-item-size, var(--codex-panel-size-nav-item))");
    expect(navItem).toContain("padding: var(--nav-item-padding, var(--size-4-1) var(--size-4-2))");
    expect(navItem).toContain("border-radius: var(--nav-item-radius, var(--radius-s))");
    expect(navItem).toContain("color: var(--nav-item-color, var(--text-muted))");
    expect(styles).toContain("background: var(--codex-panel-nav-item-background-hover, var(--background-modifier-hover))");
    expect(selectedNavItem).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedNavRow).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedNavItem).not.toContain("nav-item-background-active-hover");
    expect(selectedNavRow).not.toContain("nav-item-background-active-hover");
  });

  it("keeps chat thread row actions inset from the row edge", () => {
    const threadList = /\.codex-panel__threads \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const navRow = /\.codex-panel-ui__nav-row \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const runtimePicker = /\.codex-panel__runtime-picker \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const statusPanelItems = /\.codex-panel__status-panel-items \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(threadList).toContain("gap: var(--nav-item-margin-bottom, var(--codex-panel-panel-gap))");
    expect(runtimePicker).toContain("gap: var(--nav-item-margin-bottom, var(--codex-panel-panel-gap))");
    expect(statusPanelItems).toContain("gap: var(--nav-item-margin-bottom, var(--codex-panel-panel-gap))");
    expect(navRow).toContain("--codex-panel-nav-item-background-hover: transparent");
    expect(navRow).toContain("padding-inline-end: var(--size-4-2)");
  });

  it("keeps the composer context status text fixed-width", () => {
    const contextMeter = /\.codex-panel__composer-meta-context \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const contextDots = /\.codex-panel__composer-meta-context-dots \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const placeholderDot =
      /\.codex-panel__composer-meta-context-dot\.is-placeholder \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const contextPercent = /\.codex-panel__composer-meta-context-percent \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(contextMeter).toContain("font-variant-numeric: tabular-nums");
    expect(contextMeter).toContain("white-space: nowrap");
    expect(contextDots).toContain("display: inline-flex");
    expect(placeholderDot).toContain("color: var(--text-faint)");
    expect(contextPercent).toContain("white-space: pre");
    expect(styles).not.toContain(".codex-panel__composer-meta-context::before");
    expect(styles).not.toContain("conic-gradient");
  });

  it("aligns composer status text with the input text inset", () => {
    const composerMetaStatus = /\.codex-panel__composer-meta-status \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const composerMetaFatal = /\.codex-panel__composer-meta-fatal \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(composerMetaStatus).toContain("padding-inline-start: calc(var(--size-4-1) / 2)");
    expect(composerMetaFatal).toContain("padding-inline-start: calc(var(--size-4-1) / 2)");
  });

  it("keeps composer runtime mode icons compact and state-colored", () => {
    const modes = /\.codex-panel__composer-meta-modes \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const field = /\.codex-panel__composer-meta-field \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const labels =
      /\.codex-panel__composer-meta-model,\n\.codex-panel__composer-meta-effort \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const icon = /\.codex-panel__composer-meta-icon \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const activeIcon = /\.codex-panel__composer-meta-icon\.is-active \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const iconSvg = /\.codex-panel__composer-meta-icon svg \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(modes).toContain("gap: var(--codex-panel-control-gap)");
    expect(field).toContain("display: inline-flex");
    expect(field).toContain("flex: 0 0 auto");
    expect(field).toContain("gap: var(--size-4-2)");
    expect(labels).toContain("white-space: nowrap");
    expect(labels).not.toContain("text-overflow");
    expect(icon).toContain("width: var(--codex-panel-size-icon-xs)");
    expect(icon).toContain("height: var(--codex-panel-size-icon-xs)");
    expect(activeIcon).toContain("color: var(--icon-color-active)");
    expect(iconSvg).toContain("width: calc(var(--codex-panel-size-icon-xs) - var(--codex-panel-rail-width) / 2)");
    expect(iconSvg).toContain("height: calc(var(--codex-panel-size-icon-xs) - var(--codex-panel-rail-width) / 2)");
    expect(styles).toContain(
      ".codex-panel__composer-meta-status.is-effort-hidden .codex-panel__composer-meta-field--effort {\n  display: none;",
    );
    expect(styles).toContain(
      ".codex-panel__composer-meta-status.is-model-hidden .codex-panel__composer-meta-field--model {\n  display: none;",
    );
  });

  it("keeps nav inline input reset in the shared primitive", () => {
    const navInlineInput =
      /\.codex-panel-ui__nav-inline-input\.codex-panel-ui__nav-inline-input \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const navInlineInputFocus =
      /\.codex-panel-ui__nav-inline-input\.codex-panel-ui__nav-inline-input:focus,\n\.codex-panel-ui__nav-inline-input\.codex-panel-ui__nav-inline-input:focus-visible,\n\.codex-panel-ui__nav-inline-input\.codex-panel-ui__nav-inline-input:hover,\n\.codex-panel-ui__nav-inline-input\.codex-panel-ui__nav-inline-input:active \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";
    const chatRenameInput = /\.codex-panel__thread-rename-input \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const threadsRenameInput = /\.codex-panel-threads__rename-input \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(navInlineInput).toContain("appearance: none");
    expect(navInlineInput).toContain("color: var(--nav-item-color-active, var(--text-normal))");
    expect(navInlineInputFocus).toContain("background: transparent");
    expect(chatRenameInput).toContain("width: 100%");
    expect(chatRenameInput).not.toContain("appearance: none");
    expect(threadsRenameInput).toContain("flex: 1 1 auto");
    expect(threadsRenameInput).not.toContain("appearance: none");
  });

  it("lets the usage limit meter absorb panel width changes", () => {
    const limitList = /\.codex-panel__limit-panel-list \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const limitRow = /\.codex-panel__limit-panel-row \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const limitMeter = /\.codex-panel__limit-panel-meter \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const limitValue = /\.codex-panel__limit-panel-value \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(limitList).toContain("display: grid");
    expect(limitList).toContain("grid-template-columns: max-content max-content minmax(0, 1fr) max-content");
    expect(limitList).toContain("gap: var(--codex-panel-panel-gap) var(--codex-panel-section-gap)");
    expect(limitRow).toContain("display: contents");
    expect(limitMeter).toContain("margin: 0");
    expect(limitValue).toContain("font-variant-numeric: tabular-nums");
    expect(limitValue).not.toContain("text-align: right");
  });
});

describe("chat message CSS", () => {
  it("uses hover color instead of a pointer cursor for the inline turn diff action", () => {
    const openTurnDiff = /\.codex-panel__open-turn-diff \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const openTurnDiffHover = /\.codex-panel__open-turn-diff:hover \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(openTurnDiff).toContain("cursor: default");
    expect(openTurnDiffHover).toContain("color: var(--nav-item-color-hover, var(--text-normal))");
  });
});

describe("selection rewrite CSS", () => {
  it("aligns generation status text with the instruction input text inset", () => {
    const status = /\.codex-panel-selection-rewrite__status \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(status).toContain("padding-inline-start: calc(var(--size-4-1) / 2)");
  });
});

describe("threads view CSS", () => {
  it("keeps long row titles clear of trailing actions", () => {
    const list = /\.codex-panel-threads__list \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const rowMain = /\.codex-panel-threads__row-main \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const title = /(?:^|\n\n)\.codex-panel-threads__row-title \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(list).toContain("gap: var(--nav-item-margin-bottom, var(--codex-panel-panel-gap))");
    expect(list).toContain("padding: var(--size-4-1) var(--size-4-3)");
    expect(rowMain).toContain("box-sizing: border-box");
    expect(rowMain).not.toContain("padding-right:");
    expect(title).toContain("display: block");
  });

  it("keeps toolbar action hover color separate from row action hover color", () => {
    const toolbarAction = /\.codex-panel-ui__toolbar-action \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const toolbarHover =
      /\.codex-panel-ui__toolbar-action:hover,\n\.codex-panel-ui__toolbar-action:focus-visible \{(?<body>[^}]+)\}/.exec(styles)?.groups?.[
        "body"
      ] ?? "";
    const toolbarMouseFocus =
      /\.codex-panel-ui__toolbar-action:where\(:focus:not\(:hover\):not\(:focus-visible\)\) \{(?<body>[^}]+)\}/.exec(styles)?.groups?.[
        "body"
      ] ?? "";
    const rowHover =
      /\.codex-panel-ui__nav-row-action:hover,\n\.codex-panel-ui__nav-row-action:focus,\n\.codex-panel-ui__nav-row-action:focus-visible,\n\.codex-panel-ui__nav-row-action:active \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";

    expect(styles).not.toContain(".codex-panel-threads__toolbar-actions {");
    expect(toolbarAction).toContain("--icon-size: var(--codex-panel-control-icon-size)");
    expect(toolbarAction).toContain("--icon-stroke: var(--icon-m-stroke-width, 1.75px)");
    expect(toolbarAction).not.toContain("width:");
    expect(toolbarAction).not.toContain("height:");
    expect(toolbarAction).not.toContain("padding:");
    expect(toolbarAction).not.toContain("border-radius:");
    expect(toolbarHover).toContain("background: var(--background-modifier-hover)");
    expect(toolbarHover).toContain("color: var(--icon-color)");
    expect(toolbarHover).not.toContain("var(--icon-color-active)");
    expect(toolbarMouseFocus).toContain("background: transparent");
    expect(toolbarMouseFocus).toContain("color: var(--icon-color)");
    expect(rowHover).toContain("color: var(--icon-color-active)");
  });

  it("keeps selected thread rows stable while hovered", () => {
    const selectedRowHover =
      /\.codex-panel-ui__nav-item\.is-selected:where\(:hover, :focus, :focus-visible, :active, :focus-within\) \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";

    expect(selectedRowHover).toContain("background: var(--nav-item-background-active, var(--background-modifier-active))");
    expect(selectedRowHover).not.toContain("nav-item-background-active-hover");
  });

  it("does not rely on :has() to avoid hover-highlighting action rows", () => {
    const rowHover =
      /\.codex-panel-ui__nav-row:hover,\n\.codex-panel-ui__nav-row:focus-within \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";
    const titleHover =
      /\.codex-panel-threads__row-main:hover \.codex-panel-threads__row-title,\n\.codex-panel-threads__row-main:focus \.codex-panel-threads__row-title \{(?<body>[^}]+)\}/.exec(
        styles,
      )?.groups?.["body"] ?? "";
    const title = /(?:^|\n\n)\.codex-panel-threads__row-title \{(?<body>[^}]+)\}/.exec(styles)?.groups?.["body"] ?? "";

    expect(styles).not.toContain(":has(");
    expect(rowHover).not.toContain("--codex-panel-threads-row-title-color");
    expect(titleHover).toContain("color: var(--nav-item-color-hover, var(--text-normal))");
    expect(title).toContain("color: var(--codex-panel-threads-row-title-color)");
  });
});
