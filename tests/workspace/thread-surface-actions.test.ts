import { describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_CODEX_THREADS } from "../../src/constants";
import { CodexThreadsView } from "../../src/features/threads-view/view";
import { createThreadSurfaceActions } from "../../src/workspace/thread-surface-actions";
import type { OpenCodexPanelSnapshot } from "../../src/workspace/open-panel-snapshot";

describe("createThreadSurfaceActions", () => {
  it("falls back to the threads view when no connected chat panel can refresh shared threads", () => {
    const disconnectedPanelRefresh = vi.fn().mockResolvedValue(undefined);
    const threadsRefresh = vi.fn().mockResolvedValue(undefined);
    const threadSurfaces = createThreadSurfaceActions({
      app: {
        workspace: {
          getLeavesOfType: vi.fn((type: string) =>
            type === VIEW_TYPE_CODEX_THREADS ? [{ view: threadsView({ refresh: threadsRefresh }) }] : [],
          ),
        },
      } as never,
      panels: {
        panelViews: () => [
          {
            surface: {
              openPanelSnapshot: () => panelSnapshot({ connected: false }),
              refreshSharedThreadList: disconnectedPanelRefresh,
            },
          },
        ],
      } as never,
    });

    threadSurfaces.refreshSharedThreadListFromOpenSurface();

    expect(disconnectedPanelRefresh).not.toHaveBeenCalled();
    expect(threadsRefresh).toHaveBeenCalledOnce();
  });

  it("uses a connected chat panel before falling back to the threads view", () => {
    const disconnectedPanelRefresh = vi.fn().mockResolvedValue(undefined);
    const connectedPanelRefresh = vi.fn().mockResolvedValue(undefined);
    const threadsRefresh = vi.fn().mockResolvedValue(undefined);
    const threadSurfaces = createThreadSurfaceActions({
      app: {
        workspace: {
          getLeavesOfType: vi.fn((type: string) =>
            type === VIEW_TYPE_CODEX_THREADS ? [{ view: threadsView({ refresh: threadsRefresh }) }] : [],
          ),
        },
      } as never,
      panels: {
        panelViews: () => [
          {
            surface: {
              openPanelSnapshot: () => panelSnapshot({ viewId: "disconnected", connected: false }),
              refreshSharedThreadList: disconnectedPanelRefresh,
            },
          },
          {
            surface: {
              openPanelSnapshot: () => panelSnapshot({ viewId: "connected", connected: true }),
              refreshSharedThreadList: connectedPanelRefresh,
            },
          },
        ],
      } as never,
    });

    threadSurfaces.refreshSharedThreadListFromOpenSurface();

    expect(disconnectedPanelRefresh).not.toHaveBeenCalled();
    expect(connectedPanelRefresh).toHaveBeenCalledOnce();
    expect(threadsRefresh).not.toHaveBeenCalled();
  });
});

function threadsView(overrides: Partial<CodexThreadsView> = {}): CodexThreadsView {
  return Object.assign(Object.create(CodexThreadsView.prototype), overrides) as CodexThreadsView;
}

function panelSnapshot(overrides: Partial<OpenCodexPanelSnapshot> = {}): OpenCodexPanelSnapshot {
  return {
    viewId: "panel",
    threadId: "thread",
    lastFocused: false,
    turnLifecycle: { kind: "idle" },
    pendingApprovals: 0,
    pendingUserInputs: 0,
    hasComposerDraft: false,
    connected: true,
    ...overrides,
  };
}
