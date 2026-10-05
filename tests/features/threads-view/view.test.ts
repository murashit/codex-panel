// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../src/domain/threads/model";
import type { ThreadTitleContext } from "../../../src/domain/threads/title";
import type { ArchiveThreadResult, ThreadTitlePort } from "../../../src/features/threads/workflows/ports";
import { createThreadReplacementPublication } from "../../../src/features/threads/workflows/thread-replacement-publication";
import type { ThreadsViewHost } from "../../../src/features/threads-view/session";
import type { ThreadsViewPanelActivity } from "../../../src/features/threads-view/state";
import type { CodexThreadsView } from "../../../src/features/threads-view/view.obsidian";
import { DEFAULT_SETTINGS } from "../../../src/settings/preferences";
import type { ObservedPaginatedResult } from "../../../src/shared/async/observed-result";
import { notices } from "../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../support/async";
import { changeInputValue, installObsidianDomShims } from "../../support/dom";
import { threadMutationCommandsMock } from "../../support/thread-mutations";

const openViews: CodexThreadsView[] = [];

installObsidianDomShims();

describe("CodexThreadsView", () => {
  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
  });

  afterEach(async () => {
    for (const view of openViews.splice(0)) {
      await view.onClose();
      view.unload();
      view.containerEl.remove();
    }
  });

  it("ignores stale refresh results after close", async () => {
    const pending = deferred<void>();
    const catalog = catalogFixture();
    catalog.catalog.refreshActiveThreads.mockReturnValue(pending.promise);
    const view = await threadsView(threadsHost({ threadCatalog: catalog.catalog }));

    const refresh = view.refresh();
    await waitForAsyncWork(() => {
      expect(catalog.catalog.refreshActiveThreads).toHaveBeenCalled();
    });
    await view.onClose();
    catalog.publish(queryResult([threadFixture({ preview: "Late thread" })]));
    pending.resolve();
    await refresh;

    expect(view.containerEl.textContent).not.toContain("Late thread");
  });

  it("renders shared thread refresh failures", async () => {
    const catalog = catalogFixture();
    catalog.catalog.refreshActiveThreads.mockRejectedValue(new Error("Codex app-server stopped."));
    const host = threadsHost({ threadCatalog: catalog.catalog });
    const view = await threadsView(host);

    await view.refresh();

    const status = view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__status");
    expect(status?.textContent).toContain("Codex app-server stopped.");
    expect(view.containerEl.querySelector(".codex-panel-threads__empty")).toBeNull();
  });

  it("keeps existing threads and notifies when an explicit refresh fails", async () => {
    const catalog = catalogFixture(queryResult([threadFixture({ preview: "Cached thread" })]));
    catalog.catalog.refreshActiveThreads.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Refresh failed."));
    const view = await threadsView(threadsHost({ threadCatalog: catalog.catalog }));
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Cached thread"));

    await view.refresh();

    expect(view.containerEl.textContent).toContain("Cached thread");
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(notices).toContain("Refresh failed.");
  });

  it("uses the shared query observer as the authoritative list projection", async () => {
    const catalog = catalogFixture();
    const view = await threadsView(threadsHost({ threadCatalog: catalog.catalog }));

    await view.refresh();
    expect(view.containerEl.querySelector(".codex-panel-threads__row")).toBeNull();

    catalog.publish(queryResult([threadFixture({ id: "observed", preview: "Observed thread" })]));
    expect(view.containerEl.textContent).toContain("Observed thread");
  });

  it("shows threads in activity order even when the catalog returns them in another order", async () => {
    const catalog = catalogFixture(
      queryResult([
        threadFixture({ id: "updated-newer", preview: "Updated newer", updatedAt: 20, recencyAt: 10 }),
        threadFixture({ id: "recent", preview: "Recent activity", updatedAt: 10, recencyAt: 30 }),
      ]),
    );
    const view = await threadsView(threadsHost({ threadCatalog: catalog.catalog }));

    await view.refresh();

    expect(
      [...view.containerEl.querySelectorAll<HTMLElement>(".codex-panel-threads__row-title")].map((title) => title.textContent),
    ).toEqual(["Recent activity", "Updated newer"]);
  });

  it("keeps archive confirmation through title pointerdown, then clears it before navigation", async () => {
    const opened = deferred<void>();
    const archiveThread = vi
      .fn<ThreadsViewHost["threadMutations"]["archiveThread"]>()
      .mockResolvedValue({ kind: "archived", exportedPath: null });
    let archiveConfirmVisibleWhenOpening: boolean | null = null;
    let view!: Awaited<ReturnType<typeof threadsView>>;
    const openThreadInAvailableView = vi.fn(() => {
      view.refreshSettings();
      archiveConfirmVisibleWhenOpening = view.containerEl.querySelector(".codex-panel-threads__archive-confirm") !== null;
      return opened.promise;
    });

    view = await threadsView(threadsHost({ openThreadInAvailableView, threadMutations: threadMutationCommandsMock({ archiveThread }) }));
    document.body.append(view.containerEl);

    try {
      await view.refresh();
      view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
      expect(archiveThread).not.toHaveBeenCalled();
      const title = view.containerEl.querySelector<HTMLElement>(".codex-panel-threads__row-title");
      expect(title).not.toBeNull();
      if (!title) return;

      title.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).not.toBeNull();
      title.click();

      expect(openThreadInAvailableView).toHaveBeenCalledWith("thread");
      expect(archiveConfirmVisibleWhenOpening).toBe(false);
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).toBeNull();

      view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).toBeNull();

      view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
      const archiveWithoutSaving = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]');
      expect(archiveWithoutSaving).not.toBeNull();
      if (!archiveWithoutSaving) return;
      archiveWithoutSaving.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).not.toBeNull();
      archiveWithoutSaving.click();

      await waitForAsyncWork(() => expect(archiveThread).toHaveBeenCalledWith("thread", { saveMarkdown: false }));
      expect(openThreadInAvailableView).toHaveBeenCalledOnce();
    } finally {
      opened.resolve(undefined);
      await view.onClose();
      view.containerEl.remove();
    }
  });

  it("opens a new panel from the threads view toolbar", async () => {
    const host = threadsHost({
      openNewPanel: vi.fn().mockResolvedValue(undefined),
    });
    const view = await threadsView(host);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Open new panel"]')?.click();

    await waitForAsyncWork(() => {
      expect(host.openNewPanel).toHaveBeenCalledOnce();
    });
    expect(host.openThreadInAvailableView).not.toHaveBeenCalled();
  });

  it.each(["thread", "new-panel"])("reports %s navigation failure only while the view is open", async (target) => {
    const pending = deferred<void>();
    const navigate = vi.fn().mockRejectedValueOnce(new Error("Could not open panel")).mockReturnValueOnce(pending.promise);
    const host = threadsHost({
      openThreadInAvailableView: navigate,
      openNewPanel: navigate,
    });
    const view = await threadsView(host);
    await view.refresh();
    const selector = target === "thread" ? ".codex-panel-threads__row-main" : '[aria-label="Open new panel"]';
    view.containerEl.querySelector<HTMLElement>(selector)?.click();
    await waitForAsyncWork(() => {
      expect(notices).toEqual(["Could not open panel"]);
    });
    view.containerEl.querySelector<HTMLElement>(selector)?.click();
    await view.onClose();
    pending.reject(new Error("Closed view navigation failed"));
    await waitForAsyncWork(() => {
      expect(navigate).toHaveBeenCalledTimes(2);
    });
    expect(notices).toEqual(["Could not open panel"]);
  });

  it("refreshes threads from the threads view toolbar", async () => {
    const host = threadsHost();
    const view = await threadsView(host);

    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Refresh threads"]')?.click();

    await waitForAsyncWork(() => {
      expect(host.threadCatalog.refreshActiveThreads).toHaveBeenCalledTimes(2);
    });
  });

  it("loads another thread page only after the user requests it", async () => {
    const first = threadFixture({ id: "first", preview: "First page" });
    const second = threadFixture({ id: "second", preview: "Second page" });
    const catalog = catalogFixture(queryResult([first], null, true));
    catalog.catalog.loadMoreActiveThreads.mockImplementation(async () => {
      catalog.publish(queryResult([first, second]));
    });
    const view = await threadsView(threadsHost({ threadCatalog: catalog.catalog }));

    await view.refresh();
    expect(view.containerEl.textContent).toContain("First page");
    expect(view.containerEl.textContent).not.toContain("Second page");

    view.containerEl.querySelector<HTMLButtonElement>(".codex-panel-threads__load-more")?.click();
    await waitForAsyncWork(() => {
      expect(catalog.catalog.loadMoreActiveThreads).toHaveBeenCalledOnce();
      expect(view.containerEl.textContent).toContain("Second page");
    });
    expect(view.containerEl.querySelector(".codex-panel-threads__load-more")).toBeNull();
  });

  it("keeps existing threads and notifies when loading another page fails", async () => {
    const catalog = catalogFixture(queryResult([threadFixture({ id: "first", preview: "First page" })], null, true));
    catalog.catalog.loadMoreActiveThreads.mockRejectedValue(new Error("Load more failed."));
    const view = await threadsView(threadsHost({ threadCatalog: catalog.catalog }));

    view.containerEl.querySelector<HTMLButtonElement>(".codex-panel-threads__load-more")?.click();
    await waitForAsyncWork(() => expect(notices).toContain("Load more failed."));

    expect(view.containerEl.textContent).toContain("First page");
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
  });

  it("renders cached thread lists before refreshing", async () => {
    const pending = deferred<void>();
    const catalog = catalogFixture(queryResult([threadFixture({ id: "cached", preview: "Cached thread" })]));
    catalog.catalog.refreshActiveThreads.mockReturnValue(pending.promise);
    const view = await threadsView(threadsHost({ threadCatalog: catalog.catalog }));

    expect(view.containerEl.textContent).toContain("Cached thread");
    expect(catalog.catalog.refreshActiveThreads).toHaveBeenCalledOnce();
    await view.onClose();
    pending.resolve();
  });

  it("lets a completed archive settle after the threads view closes", async () => {
    const archived = deferred<ArchiveThreadResult>();
    const archiveThread = vi.fn<ThreadsViewHost["threadMutations"]["archiveThread"]>(() => archived.promise);

    const view = await threadsView(threadsHost({ threadMutations: threadMutationCommandsMock({ archiveThread }) }));

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Save and archive thread"]')?.click();
    await waitForAsyncWork(() => expect(archiveThread).toHaveBeenCalledWith("thread", { saveMarkdown: true }));
    expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Save and archive thread"]')?.disabled).toBe(true);
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Save and archive thread"]')?.click();
    expect(archiveThread).toHaveBeenCalledOnce();

    await view.onClose();
    archived.resolve({ kind: "archived", exportedPath: "Codex Archives/thread.md" });
    await archived.promise;
    expect(notices).toEqual([]);
    expect(view.containerEl.childElementCount).toBe(0);
  });

  it("does not archive a thread while its panel is pending or running", async () => {
    const archiveThread = vi
      .fn<ThreadsViewHost["threadMutations"]["archiveThread"]>()
      .mockResolvedValue({ kind: "archived", exportedPath: null });

    const view = await threadsView(
      threadsHost({
        threadMutations: threadMutationCommandsMock({ archiveThread }),
        visiblePanelActivities: vi.fn(() => [{ threadId: "thread", selected: false, pending: true, running: false }]),
      }),
    );
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));

    const archiveButton = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]');
    expect(archiveButton?.disabled).toBe(true);
    archiveButton?.click();
    expect(archiveThread).not.toHaveBeenCalled();
  });

  it("keeps replacement panel activity on a visible row while the catalog observer is delayed", async () => {
    const source = threadFixture({ id: "source", preview: "Source" });
    const replacement = threadFixture({ id: "replacement", preview: "Replacement" });
    let cachedThreads: readonly Thread[] = [source];
    let activities: readonly ThreadsViewPanelActivity[] = [{ threadId: "source", selected: true, pending: false, running: false }];
    const publication = createThreadReplacementPublication((facts) => {
      for (const fact of facts) {
        if (fact.type === "thread-upserted") cachedThreads = [fact.thread, ...cachedThreads.filter((item) => item.id !== fact.thread.id)];
        if (fact.type === "thread-archived") cachedThreads = cachedThreads.filter((item) => item.id !== fact.threadId);
      }
    });
    const pending = publication.begin("source");
    pending.attach(replacement);
    const view = await threadsView(
      threadsHost({
        threadCatalog: {
          ...catalogFixture(queryResult([source])).catalog,
          activeThreadsSnapshot: () => cachedThreads,
        },
        visiblePanelActivities: (threads: readonly Thread[]) =>
          activities.map((activity) => ({
            ...activity,
            threadId: publication.visibleThreadId(threads, activity.threadId),
          })),
      }),
    );

    activities = [{ threadId: "replacement", selected: true, pending: false, running: false }];
    view.refreshLiveState();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(view.containerEl.querySelector(".codex-panel-threads__row--selected")?.textContent).toContain("Source");

    view.refreshLiveState();
    pending.finish(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(view.containerEl.querySelector(".codex-panel-threads__row--selected")?.textContent).toContain("Replacement");
  });

  it("keeps the rename editor locked until a save finishes", async () => {
    const saved = deferred<boolean>();
    const renameThreadRequest = vi.fn<ThreadsViewHost["threadMutations"]["renameThread"]>(() => saved.promise);
    const view = await threadsView(threadsHost({ threadMutations: threadMutationCommandsMock({ renameThread: renameThreadRequest }) }));

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const firstInput = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(firstInput).not.toBeNull();
    if (!firstInput) return;
    changeInputValue(firstInput, "  Saved   title  ");
    firstInput.dispatchEvent(new FocusEvent("blur"));
    await waitForAsyncWork(() => {
      expect(renameThreadRequest).toHaveBeenCalledWith("thread", "  Saved   title  ", { shouldStart: expect.any(Function) });
    });

    firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(true);
    expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).toBeNull();

    saved.resolve(true);

    await waitForAsyncWork(() => expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")).toBeNull());
  });

  it("restores the same editor when a locked rename save fails", async () => {
    const saved = deferred<boolean>();
    const renameThreadRequest = vi.fn<ThreadsViewHost["threadMutations"]["renameThread"]>(() => saved.promise);
    const view = await threadsView(threadsHost({ threadMutations: threadMutationCommandsMock({ renameThread: renameThreadRequest }) }));

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    const firstInput = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    if (!firstInput) throw new Error("Missing rename input");
    changeInputValue(firstInput, "Saved title");
    firstInput.dispatchEvent(new FocusEvent("blur"));
    await waitForAsyncWork(() => expect(renameThreadRequest).toHaveBeenCalledOnce());

    firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(true);

    saved.reject(new Error("Rename failed."));
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Saved title");
    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(false);
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(notices).toContain("Rename failed.");
  });

  it("notifies an archive failure without adding list status", async () => {
    const archiveThread = vi.fn<ThreadsViewHost["threadMutations"]["archiveThread"]>().mockRejectedValue(new Error("Archive failed."));
    const view = await threadsView(threadsHost({ threadMutations: threadMutationCommandsMock({ archiveThread }) }));
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));

    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]')?.click();
    await waitForAsyncWork(() => expect(notices).toContain("Archive failed."));

    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).not.toBeNull();
  });

  it("reports the saved note as well as an archive failure and keeps retry controls", async () => {
    const archiveThread = vi.fn<ThreadsViewHost["threadMutations"]["archiveThread"]>().mockResolvedValue({
      kind: "failed",
      message: "Archive failed.",
      exportedPath: "Codex Archives/thread.md",
    });
    const view = await threadsView(threadsHost({ threadMutations: threadMutationCommandsMock({ archiveThread }) }));
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("Thread preview"));

    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Save and archive thread"]')?.click();
    await waitForAsyncWork(() => expect(notices).toContain("Archive failed."));

    expect(archiveThread).toHaveBeenCalledWith("thread", { saveMarkdown: true });
    expect(notices).toContain("Saved thread to Codex Archives/thread.md.");
    expect(view.containerEl.querySelector(".codex-panel-threads__archive-confirm")).not.toBeNull();
    await view.onClose();
  });

  it("auto-names a thread rename draft from completed history", async () => {
    const context = { userRequest: "threads viewのrenameを直したい", assistantResponse: "rename UIを調整しました。" };
    const titlePort = titlePortFixture();
    titlePort.persistedContext.mockResolvedValue(context);
    titlePort.generateTitle.mockResolvedValue("Threads rename UI");
    const view = await threadsView(threadsHost({ threadTitlePort: titlePort }));

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();

    await waitForAsyncWork(() => {
      expect(titlePort.persistedContext).toHaveBeenCalledOnce();
      expect(titlePort.persistedContext).toHaveBeenCalledWith("thread");
      expect(titlePort.generateTitle).toHaveBeenCalledOnce();
      expect(titlePort.generateTitle).toHaveBeenCalledWith(context, expect.any(AbortSignal));
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Threads rename UI");
    });
  });

  it("disables auto-name while completed history is loading", async () => {
    const history = deferred<ThreadTitleContext | null>();
    const titlePort = titlePortFixture();
    titlePort.persistedContext.mockReturnValue(history.promise);
    const view = await threadsView(threadsHost({ threadTitlePort: titlePort }));

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(titlePort.persistedContext).toHaveBeenCalledOnce();
    });

    expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    expect(view.containerEl.querySelector(".codex-panel-threads__status")).toBeNull();
    expect(titlePort.generateTitle).not.toHaveBeenCalled();
    await view.onClose();
    history.resolve(null);
  });

  it("keeps loading auto-name history while a rename save is in flight", async () => {
    const history = deferred<ThreadTitleContext | null>();
    const saved = deferred<boolean>();
    const titlePort = titlePortFixture();
    titlePort.persistedContext.mockReturnValue(history.promise);
    titlePort.generateTitle.mockResolvedValue("Generated title");
    const view = await threadsView(
      threadsHost({
        threadTitlePort: titlePort,
        threadMutations: threadMutationCommandsMock({ renameThread: vi.fn(() => saved.promise) }),
      }),
    );

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => expect(titlePort.persistedContext).toHaveBeenCalledOnce());
    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    if (!input) throw new Error("Missing rename input");
    input.dispatchEvent(new FocusEvent("blur"));
    changeInputValue(input, "Changed while saving");
    history.resolve({ userRequest: "Name this", assistantResponse: "Done." });
    saved.reject(new Error("Rename failed."));

    await waitForAsyncWork(() => {
      expect(titlePort.persistedContext).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    const autoName = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]');
    autoName?.click();
    await waitForAsyncWork(() => {
      expect(titlePort.generateTitle).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Generated title");
    });
  });

  it("does not remount the threads view when auto-name finishes after close", async () => {
    const generatedTitle = deferred<string | null>();
    const titlePort = titlePortFixture();
    titlePort.persistedContext.mockResolvedValue({ userRequest: "Name this", assistantResponse: "Done." });
    titlePort.generateTitle.mockReturnValue(generatedTitle.promise);
    const view = await threadsView(threadsHost({ threadTitlePort: titlePort }));

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(titlePort.generateTitle).toHaveBeenCalledOnce();
    });
    const generationSignal = titlePort.generateTitle.mock.calls[0]?.[1];
    await view.onClose();
    expect(generationSignal?.aborted).toBe(true);
    generatedTitle.resolve("Late title");
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(view.containerEl.childElementCount).toBe(0);
    expect(view.containerEl.textContent).not.toContain("Late title");
  });

  it("cancels auto-name without applying a late generated title", async () => {
    const generatedTitle = deferred<string | null>();
    const titlePort = titlePortFixture();
    titlePort.persistedContext.mockResolvedValue({ userRequest: "Name this", assistantResponse: "Done." });
    titlePort.generateTitle.mockReturnValue(generatedTitle.promise);
    const view = await threadsView(threadsHost({ threadTitlePort: titlePort }));
    document.body.append(view.containerEl);

    await view.refresh();
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(false);
    });
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    await waitForAsyncWork(() => {
      expect(titlePort.generateTitle).toHaveBeenCalledOnce();
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')).toBeNull();
      expect(view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]')).not.toBeNull();
    });

    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(input).not.toBeNull();
    if (!input) return;
    expect(input.disabled).toBe(true);
    const generationSignal = titlePort.generateTitle.mock.calls[0]?.[1];
    expect(generationSignal?.aborted).toBe(false);
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]')?.click();
    const editableInput = view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input");
    expect(generationSignal?.aborted).toBe(true);
    expect(editableInput?.disabled).toBe(false);
    expect(editableInput?.value).toBe("Thread preview");
    expect(document.activeElement).toBe(editableInput);
    generatedTitle.resolve("Generated title");
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(view.containerEl.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.value).toBe("Thread preview");
    expect(view.containerEl.textContent).not.toContain("Generated title");
    view.containerEl.remove();
  });

  it("accepts a replacement runtime after an observer fails during detachment", async () => {
    const unsubscribe = vi.fn(() => {
      throw new Error("observer cleanup failed");
    });
    const view = await threadsView(
      threadsHost({
        threadCatalog: { ...catalogFixture().catalog, observeActiveThreadsResult: () => unsubscribe },
      }),
    );

    expect(() => view.detachRuntime()).not.toThrow();
    expect(unsubscribe).toHaveBeenCalledOnce();

    const refresh = vi.fn<ThreadsViewHost["threadCatalog"]["refreshActiveThreads"]>().mockResolvedValue(undefined);
    expect(() =>
      view.attachRuntime(
        threadsHost({
          threadCatalog: { ...catalogFixture().catalog, refreshActiveThreads: refresh },
        }),
      ),
    ).not.toThrow();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await view.refresh();
    expect(refresh).toHaveBeenCalledTimes(2);
    await view.onClose();
  });

  it("ignores refresh requests while detached from an execution runtime", async () => {
    const view = await threadsView();
    view.detachRuntime();

    await expect(view.refresh()).resolves.toBeUndefined();
    expect(() => view.refreshLiveState()).not.toThrow();
    expect(() => view.refreshSettings()).not.toThrow();
  });
});

function threadsHost(overrides: Partial<ThreadsViewHost> = {}) {
  return {
    settings: { archiveExportEnabled: () => DEFAULT_SETTINGS.archiveExportEnabled },
    threadCatalog: catalogFixture(queryResult([threadFixture({ preview: "Thread preview" })])).catalog,
    threadMutations: threadMutationCommandsMock(),
    threadTitlePort: titlePortFixture(),
    openNewPanel: vi.fn<ThreadsViewHost["openNewPanel"]>().mockResolvedValue(undefined),
    openThreadInAvailableView: vi.fn<ThreadsViewHost["openThreadInAvailableView"]>().mockResolvedValue(undefined),
    visiblePanelActivities: () => [],
    ...overrides,
  } satisfies ThreadsViewHost;
}

function catalogFixture(initial = queryResult(null)) {
  let result = initial;
  let observer: ((result: ObservedPaginatedResult<readonly Thread[]>) => void) | null = null;
  return {
    publish(next: ObservedPaginatedResult<readonly Thread[]>) {
      result = next;
      observer?.(result);
    },
    catalog: {
      activeThreadsSnapshot: () => result.value,
      refreshActiveThreads: vi.fn<ThreadsViewHost["threadCatalog"]["refreshActiveThreads"]>().mockResolvedValue(undefined),
      loadMoreActiveThreads: vi.fn<ThreadsViewHost["threadCatalog"]["loadMoreActiveThreads"]>().mockResolvedValue(undefined),
      observeActiveThreadsResult: (listener: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
        observer = listener;
        listener(result);
        return () => {
          observer = null;
        };
      },
    } satisfies ThreadsViewHost["threadCatalog"],
  };
}

function titlePortFixture() {
  return {
    persistedContext: vi.fn<ThreadTitlePort["persistedContext"]>().mockResolvedValue(null),
    generateTitle: vi.fn<ThreadTitlePort["generateTitle"]>().mockRejectedValue(new Error("Unexpected title generation.")),
  } satisfies ThreadTitlePort;
}

async function threadsView(host = threadsHost()) {
  const { CodexThreadsView } = await import("../../../src/features/threads-view/view.obsidian");
  const containerEl = document.createElement("div");
  const view = new CodexThreadsView(
    {
      app: {
        vault: {
          adapter: {},
        },
      },
      containerEl,
    } as never,
    {
      attachThreadsView: (runtimeView) => {
        runtimeView.attachRuntime(host);
      },
    },
  );
  openViews.push(view);
  view.load();
  await view.onOpen();
  return view;
}

function queryResult(
  value: readonly Thread[] | null,
  error: Error | null = null,
  hasMore = false,
): ObservedPaginatedResult<readonly Thread[]> {
  return {
    value,
    error,
    isFetching: false,
    hasMore,
    isFetchingNextPage: false,
  };
}

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread",
    preview: "",
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
