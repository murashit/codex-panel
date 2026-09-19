// @vitest-environment jsdom

import { type App, Modal } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatState } from "../../../../src/features/chat/application/state/model";
import * as confirmation from "../../../../src/features/chat/host/composer/confirm-fork-discard.obsidian";
import { deferred, waitForAsyncWork } from "../../../support/async";
import {
  chatHost,
  chatView,
  composerElement,
  connectedClient,
  connectionMockState,
  requiredButton,
  setupViewConnectionHarness,
  submitComposerByEnter,
} from "./view-connection-harness";

describe("fork cancellation", () => {
  setupViewConnectionHarness();
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])("requires explicit discard in the confirmation dialog (discard=%s)", async (discard) => {
    let dialog: Modal | null = null;
    vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
      dialog = this;
      document.body.append(this.contentEl);
      this.onOpen();
    });
    const result = confirmation.confirmForkDiscard({} as App);
    const opened = dialog as Modal | null;
    if (!opened) throw new Error("Expected discard dialog");
    expect(document.activeElement?.textContent).toBe("Keep editing");
    const buttons = opened.contentEl.querySelectorAll("button");
    if (discard) buttons[1]?.click();
    else opened.close();
    await expect(result).resolves.toBe(discard);
    opened.contentEl.remove();
  });

  async function setup(text = "original prompt", client = connectedClient()) {
    const host = chatHost({ settings: { showToolbar: false } });
    connectionMockState().client = client;
    const view = await chatView({ host });
    await view.onOpen();
    await view.surface.applyForkDraft({
      draft: { sourceThreadId: "source", boundary: { kind: "before-turn", turnId: "last" }, initialPrompt: "original prompt" },
      runtime: createChatState().runtime,
      display: { items: [], turnDiffs: new Map() },
    });
    view.surface.setComposerText(text);
    await waitForAsyncWork(() => expect(view.containerEl.querySelector(".codex-panel__cancel-fork")).not.toBeNull());
    return { host, view, button: requiredButton(view.containerEl, ".codex-panel__cancel-fork") };
  }

  it("offers an accessible cancel action without confirming the unedited rollback prompt", async () => {
    const confirm = vi.spyOn(confirmation, "confirmForkDiscard");
    const { host, view, button } = await setup();
    expect(button.dataset["icon"]).toBe("arrow-left");
    expect(button.getAttribute("aria-label")).toBe("Return to source thread");
    expect(button.type).toBe("button");
    button.click();
    await waitForAsyncWork(() =>
      expect(host.workspace.returnFromForkDraft).toHaveBeenCalledWith("source", expect.any(String), expect.any(Function)),
    );
    expect(confirm).not.toHaveBeenCalled();
    await view.onClose();
  });

  it.each([false, true])("protects edited input while discard confirmation is pending (discard=%s)", async (discard) => {
    const pending = deferred<boolean>();
    vi.spyOn(confirmation, "confirmForkDiscard").mockReturnValue(pending.promise);
    const { host, view, button } = await setup("edited prompt");
    button.click();
    await waitForAsyncWork(() => expect(button.disabled).toBe(true));
    expect(composerElement(view).readOnly).toBe(true);
    await submitComposerByEnter(view);
    expect(host.workspace.returnFromForkDraft).not.toHaveBeenCalled();
    pending.resolve(discard);
    await waitForAsyncWork(() => expect(button.disabled).toBe(false));
    expect(host.workspace.returnFromForkDraft).toHaveBeenCalledTimes(discard ? 1 : 0);
    expect(composerElement(view).value).toBe("edited prompt");
    await view.onClose();
  });

  it("keeps the draft when the source cannot be opened and permits retry", async () => {
    const resume = vi.fn().mockRejectedValue(new Error("source unavailable"));
    const { host, view, button } = await setup("original prompt", connectedClient({ "thread/resume": resume }));
    vi.mocked(host.workspace.returnFromForkDraft).mockImplementation((threadId) => view.surface.activateThread(threadId));
    button.click();
    await waitForAsyncWork(() => expect(host.workspace.returnFromForkDraft).toHaveBeenCalledOnce());
    await waitForAsyncWork(() => expect(button.disabled).toBe(false));
    expect(resume).toHaveBeenCalledOnce();
    expect(view.surface.openPanelSnapshot().hasForkDraft).toBe(true);
    expect(composerElement(view).value).toBe("original prompt");
    button.click();
    await waitForAsyncWork(() => expect(host.workspace.returnFromForkDraft).toHaveBeenCalledTimes(2));
    await view.onClose();
  });

  it("disables cancellation during fork creation and restores it after creation fails", async () => {
    const pending = deferred<never>();
    const fork = vi.fn(() => pending.promise);
    const { host, view, button } = await setup("original prompt", connectedClient({ "thread/fork": fork }));
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => expect(fork).toHaveBeenCalledOnce());
    await waitForAsyncWork(() => expect(button.disabled).toBe(true));
    button.click();
    expect(host.workspace.returnFromForkDraft).not.toHaveBeenCalled();
    pending.reject(new Error("source unavailable"));
    await waitForAsyncWork(() => expect(button.disabled).toBe(false));
    expect(composerElement(view).value).toBe("original prompt");
    await view.onClose();
  });

  it("does not return after the panel closes during confirmation", async () => {
    const pending = deferred<boolean>();
    vi.spyOn(confirmation, "confirmForkDiscard").mockReturnValue(pending.promise);
    const { host, view, button } = await setup("edited prompt");
    button.click();
    await view.onClose();
    pending.resolve(true);
    await Promise.resolve();
    expect(host.workspace.returnFromForkDraft).not.toHaveBeenCalled();
  });
});
