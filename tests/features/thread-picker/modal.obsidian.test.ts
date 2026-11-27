// @vitest-environment jsdom

import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { Thread } from "../../../src/domain/threads/model";
import { openThreadPicker } from "../../../src/features/thread-picker/modal.obsidian";
import { notices } from "../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../support/async";
import { popoutWindow } from "../../support/dom";
import { panelThreadFixture as thread } from "../../support/panel-thread";
import { threadCatalogFixture } from "../../support/thread-catalog";

const recent = thread({ id: "recent", name: "Target" });
const older = thread({ id: "older", name: "Older target" });

function picker(read = async (): Promise<readonly Thread[]> => [recent]) {
  const { catalog } = threadCatalogFixture(read);
  const onClosed = vi.fn();
  const openThreadInCurrentView = vi.fn(async (_id: string) => undefined);
  const openThreadInAvailableView = vi.fn(async (_id: string) => undefined);
  const modal = openThreadPicker(
    { app: {} as never, threadCatalog: catalog, openThreadInCurrentView, openThreadInAvailableView },
    onClosed,
  );
  onTestFinished(() => modal.close());
  const display = vi.fn<(ids: string[]) => void>();
  // The native SuggestModal renders getSuggestions(current input) on each input event.
  modal.inputEl.addEventListener("input", () => {
    display(modal.getSuggestions(modal.inputEl.value).map(({ id }) => id));
  });
  const type = (query: string) => {
    modal.inputEl.value = query;
    modal.inputEl.dispatchEvent(new Event("input"));
  };
  const shows = (ids: string[]) => waitForAsyncWork(() => expect(display).toHaveBeenLastCalledWith(ids));
  return { catalog, modal, display, type, shows, onClosed, openThreadInCurrentView, openThreadInAvailableView };
}

describe("Open thread picker", () => {
  it("uses recent pin order and searches older rows by title", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce([recent, older])
      .mockResolvedValue([recent, older, thread({ id: "oldest", name: "Another target" })]);
    const { catalog, type, shows } = picker(read);
    await shows(["recent", "older"]);
    catalog.facts.apply({ type: "thread-upserted", thread: recent });
    catalog.facts.apply({ type: "thread-pinned", threadId: older.id, isPinned: true });
    await shows(["older", "recent"]);
    expect(read).toHaveBeenCalledOnce();
    type("target");
    await shows(["recent", "older", "oldest"]);
    type("another");
    await shows(["oldest"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shows a failed search in the picker and retries on the next input", async () => {
    const read = vi.fn().mockResolvedValueOnce([recent]).mockRejectedValueOnce(new Error("Search unavailable")).mockResolvedValue([older]);
    const { modal, type, shows } = picker(read);
    await shows(["recent"]);
    type("target");
    await waitForAsyncWork(() => expect(modal.emptyStateText).toBe("Search unavailable"));
    expect(read).toHaveBeenCalledTimes(2);
    type("target");
    await shows(["older"]);
  });

  it.each(["clear", "close"])("keeps a pending scan from updating the display after %s", async (action) => {
    const scan = deferred<readonly Thread[]>();
    const read = vi.fn().mockResolvedValueOnce([recent]).mockReturnValueOnce(scan.promise);
    const { modal, type, display, shows } = picker(read);
    await shows(["recent"]);
    type("older");
    await shows([]);
    expect(modal.emptyStateText).toBe("Searching older Codex threads…");
    if (action === "clear") type("");
    else modal.close();
    const lastDisplay = display.mock.lastCall;
    scan.resolve([recent, older]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(display.mock.lastCall).toBe(lastDisplay);
  });

  it.each(["", "target"])("reflects a published replacement without editing query %j", async (query) => {
    let rows = [recent];
    const { catalog, type, shows, display } = picker(async () => rows);
    await shows(["recent"]);
    type(query);
    await shows(["recent"]);
    const replacement = catalog.beginReplacement(recent.id, "create");
    replacement.attach(older);
    rows = [older];
    replacement.finish(true);
    await waitForAsyncWork(() => expect(display).toHaveBeenLastCalledWith(["older"]));
  });

  it.each(["main", "popout"])("dispatches the selected thread to the requested panel in a %s window", async (target) => {
    const { modal, shows, openThreadInCurrentView, openThreadInAvailableView } = picker();
    await shows(["recent"]);
    const viewWindow = target === "popout" ? popoutWindow() : window;
    const Key = (viewWindow as Window & { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
    modal.onChooseSuggestion(recent, new MouseEvent("click", { ctrlKey: true }));
    modal.onChooseSuggestion(recent, new Key("keydown", { key: "Enter" }));
    modal.inputEl.dispatchEvent(new Key("keydown", { key: "Enter", ctrlKey: true }));
    modal.inputEl.dispatchEvent(new Key("keydown", { key: "Enter", metaKey: true }));
    expect(openThreadInCurrentView.mock.calls).toEqual([["recent"], ["recent"]]);
    expect(openThreadInAvailableView.mock.calls).toEqual([["recent"], ["recent"]]);
  });

  it.each([
    { message: "No Codex threads found.", read: async () => [] },
    {
      message: "Offline",
      read: async () => {
        throw new Error("Offline");
      },
    },
  ])("reports $message when the initial list cannot open", async ({ message, read }) => {
    const { onClosed, display } = picker(read);
    await waitForAsyncWork(() => expect(onClosed).toHaveBeenCalledOnce());
    expect(notices.at(-1)).toBe(message);
    expect(display).not.toHaveBeenCalled();
  });

  it("stays closed when an initial load completes after dismissal", async () => {
    const pending = deferred<readonly Thread[]>();
    const { modal, display, onClosed } = picker(() => pending.promise);
    modal.close();
    pending.resolve([recent]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    modal.close();
    expect(display).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledOnce();
  });
});
