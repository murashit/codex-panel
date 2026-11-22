// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { DeferredTask } from "../../../src/shared/async/deferred-task";
import { popoutWindow } from "../../support/dom";

describe("DeferredTask", () => {
  it("coalesces pending warmups and allows another after completion", async () => {
    const tasks = new DeferredTask(() => window, 0);
    const list = document.createElement("ul");
    const warmup = () => list.appendChild(document.createElement("li"));

    tasks.schedule(warmup);
    tasks.schedule(warmup);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(list.children).toHaveLength(1);

    tasks.schedule(warmup);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(list.children).toHaveLength(2);
  });

  it("cancels work in the scheduling window after a panel moves", async () => {
    let owner = popoutWindow();
    const tasks = new DeferredTask(() => owner, 0);
    const stale = document.createElement("p");
    tasks.schedule(() => (stale.textContent = "stale"));
    owner = window;
    tasks.clear();
    await new Promise<void>((resolve) => tasks.schedule(resolve));
    expect(stale.textContent).toBe("");
  });
});
