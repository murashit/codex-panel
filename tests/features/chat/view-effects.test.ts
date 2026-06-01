import { describe, expect, it, vi } from "vitest";

import type { DisplayItem } from "../../../src/features/chat/display/types";
import { createChatViewEffects, type ChatViewEffectHost } from "../../../src/features/chat/view-effects";

function createSystemDisplayItem(text: string): DisplayItem {
  return { id: "system", kind: "system", role: "system", text };
}

function createHost(): ChatViewEffectHost {
  return {
    render: vi.fn(),
    renderShellSlots: vi.fn(),
    scheduleRender: vi.fn(),
    refreshLiveState: vi.fn(),
    deferRefreshLiveState: vi.fn(),
    forceMessagesToBottom: vi.fn(),
    correctMessagesAfterLayoutChange: vi.fn(),
    preserveMessageScrollPosition: vi.fn(),
    scrollMessagesToBottomOnFocus: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    invalidateConnectionWork: vi.fn(),
    invalidateResumeWork: vi.fn(),
    scheduleDeferredDiagnostics: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    scheduleDeferredRestoredThreadHydration: vi.fn(),
    clearDeferredRestoredThreadHydration: vi.fn(),
    scheduleDeferredAppServerWarmup: vi.fn(),
    dispatch: vi.fn(),
    systemItem: vi.fn(createSystemDisplayItem),
    restoreThreadPlaceholder: vi.fn(),
    clearRestoredThreadLifecycle: vi.fn(),
    refreshTabHeader: vi.fn(),
    clearClient: vi.fn(),
    setComposerText: vi.fn(),
    ensureConnected: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createChatViewEffects", () => {
  it("groups view-host effects by responsibility", async () => {
    const host = createHost();
    const effects = createChatViewEffects(host);
    const action = { type: "status/set" as const, status: "ready" };
    const details = [{ title: "detail", body: "body" }];
    const restoredThread = { threadId: "thread", title: "Title", explicitName: null };

    effects.render.now();
    effects.render.shellSlots();
    effects.render.schedule({ forceSlots: true });
    effects.liveState.refresh();
    effects.liveState.deferRefresh();
    effects.scroll.forceBottom();
    effects.scroll.correctAfterLayoutChange();
    effects.scroll.preservePosition();
    effects.scroll.bottomOnFocus();
    effects.status.set("ready");
    effects.status.addSystemMessage("message");
    effects.status.addStructuredSystemMessage("structured", details);
    effects.thread.notifyIdentityChanged();
    effects.thread.resetTurnPresence(false);
    effects.thread.restorePlaceholder(restoredThread);
    effects.thread.clearRestoredLifecycle();
    effects.thread.refreshTabHeader();
    effects.lifecycle.invalidateConnectionWork();
    effects.lifecycle.invalidateResumeWork();
    effects.lifecycle.scheduleDeferredDiagnostics();
    effects.lifecycle.clearDeferredDiagnostics();
    effects.lifecycle.scheduleDeferredRestoredThreadHydration();
    effects.lifecycle.clearDeferredRestoredThreadHydration();
    effects.lifecycle.scheduleDeferredAppServerWarmup();
    effects.state.dispatch(action);
    expect(effects.state.systemItem("system")).toEqual(createSystemDisplayItem("system"));
    effects.client.clear();
    await effects.client.ensureConnected();
    effects.composer.setText("draft");

    expect(host.render).toHaveBeenCalledOnce();
    expect(host.renderShellSlots).toHaveBeenCalledOnce();
    expect(host.scheduleRender).toHaveBeenCalledWith({ forceSlots: true });
    expect(host.refreshLiveState).toHaveBeenCalledOnce();
    expect(host.deferRefreshLiveState).toHaveBeenCalledOnce();
    expect(host.forceMessagesToBottom).toHaveBeenCalledOnce();
    expect(host.correctMessagesAfterLayoutChange).toHaveBeenCalledOnce();
    expect(host.preserveMessageScrollPosition).toHaveBeenCalledOnce();
    expect(host.scrollMessagesToBottomOnFocus).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("ready");
    expect(host.addSystemMessage).toHaveBeenCalledWith("message");
    expect(host.addStructuredSystemMessage).toHaveBeenCalledWith("structured", details);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.restoreThreadPlaceholder).toHaveBeenCalledWith(restoredThread);
    expect(host.clearRestoredThreadLifecycle).toHaveBeenCalledOnce();
    expect(host.refreshTabHeader).toHaveBeenCalledOnce();
    expect(host.invalidateConnectionWork).toHaveBeenCalledOnce();
    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.clearDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredRestoredThreadHydration).toHaveBeenCalledOnce();
    expect(host.clearDeferredRestoredThreadHydration).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredAppServerWarmup).toHaveBeenCalledOnce();
    expect(host.dispatch).toHaveBeenCalledWith(action);
    expect(host.systemItem).toHaveBeenCalledWith("system");
    expect(host.clearClient).toHaveBeenCalledOnce();
    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(host.setComposerText).toHaveBeenCalledWith("draft");
  });
});
