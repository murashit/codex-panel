// @vitest-environment jsdom

import { Component } from "obsidian";
import { expect, it, onTestFinished, vi } from "vitest";
import { registerViewPointerDown } from "../../../src/shared/ui/view-pointer.obsidian";
import { popoutWindow } from "../../support/dom";

it("follows the view document across migration and stops listening on unload", () => {
  const root = document.createElement("div");
  const next = popoutWindow();
  const owner = new Component();
  owner.load();
  onTestFinished(() => owner.unload());
  let migrate: (win: Window) => void = () => undefined;
  const unregister = vi.fn();
  root.onWindowMigrated = (callback) => {
    migrate = callback;
    return unregister;
  };
  const handler = vi.fn();
  registerViewPointerDown(owner, root, handler);
  document.dispatchEvent(new Event("pointerdown"));
  expect(handler).toHaveBeenCalledTimes(1);
  next.document.body.append(root);
  migrate(next);
  document.dispatchEvent(new Event("pointerdown"));
  expect(handler).toHaveBeenCalledTimes(1);
  next.document.dispatchEvent(new Event("pointerdown"));
  expect(handler).toHaveBeenCalledTimes(2);
  owner.unload();
  next.document.dispatchEvent(new Event("pointerdown"));
  expect(handler).toHaveBeenCalledTimes(2);
  expect(unregister).toHaveBeenCalledOnce();
});
