// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { toolbarOutsidePointerHit } from "../../../../../src/features/chat/host/toolbar/hit-test.dom";

function pointerAt(target: EventTarget | null): PointerEvent {
  return { target } as PointerEvent;
}

describe("toolbarOutsidePointerHit", () => {
  it("classifies toolbar panels and archive confirmation descendants inside the panel root", () => {
    const root = document.createElement("div");
    const panel = root.appendChild(document.createElement("div"));
    panel.className = "codex-panel__toolbar-panel";
    const ordinaryTarget = panel.appendChild(document.createElement("button"));
    const archiveConfirm = panel.appendChild(document.createElement("div"));
    archiveConfirm.className = "codex-panel__archive-confirm";
    const confirmTarget = archiveConfirm.appendChild(document.createElement("button"));

    expect(toolbarOutsidePointerHit(pointerAt(ordinaryTarget), root, window)).toEqual({
      insideToolbarPanel: true,
      insideArchiveConfirm: false,
    });
    expect(toolbarOutsidePointerHit(pointerAt(confirmTarget), root, window)).toEqual({
      insideToolbarPanel: true,
      insideArchiveConfirm: true,
    });
  });

  it("does not treat a matching toolbar class outside the supplied root as inside", () => {
    const root = document.createElement("div");
    const externalPanel = document.createElement("div");
    externalPanel.className = "codex-panel__toolbar-primary";
    const target = externalPanel.appendChild(document.createElement("button"));

    expect(toolbarOutsidePointerHit(pointerAt(target), root, window)).toEqual({
      insideToolbarPanel: false,
      insideArchiveConfirm: false,
    });
  });

  it("recognizes toolbar descendants in a separate view window", () => {
    const iframe = document.body.appendChild(document.createElement("iframe"));
    const viewWindow = iframe.contentWindow;
    if (!viewWindow) throw new Error("Expected a separate view window.");
    try {
      const root = viewWindow.document.createElement("div");
      const panel = root.appendChild(viewWindow.document.createElement("div"));
      panel.className = "codex-panel__toolbar-panel";
      const target = panel.appendChild(viewWindow.document.createElement("button"));

      expect(toolbarOutsidePointerHit(pointerAt(target), root, viewWindow)).toEqual({
        insideToolbarPanel: true,
        insideArchiveConfirm: false,
      });
    } finally {
      iframe.remove();
    }
  });

  it.each([
    { name: "a missing root", root: null, viewWindow: window, target: document.body },
    { name: "a non-element target", root: document.createElement("div"), viewWindow: window, target: document },
  ])("classifies $name as outside", ({ root, viewWindow, target }) => {
    expect(toolbarOutsidePointerHit(pointerAt(target), root, viewWindow)).toEqual({
      insideToolbarPanel: false,
      insideArchiveConfirm: false,
    });
  });
});
