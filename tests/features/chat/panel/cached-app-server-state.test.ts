import { describe, expect, it, vi } from "vitest";

import { createServerDiagnostics } from "../../../../src/domain/server/diagnostics";
import { emptyRuntimeConfigSnapshot } from "../../../../src/app-server/protocol/runtime-config";
import { applyCachedSharedAppServerState } from "../../../../src/features/chat/panel/cached-app-server-state";
import type { SharedServerMetadata } from "../../../../src/app-server/services/shared-cache-state";
import type { Thread } from "../../../../src/domain/threads/model";

describe("cached app-server state", () => {
  it("does not apply missing cached thread snapshots as shared truth", () => {
    const serverThreads = { applyThreadList: vi.fn(), loadThreadList: vi.fn(), startThread: vi.fn() };
    const serverMetadata = { ...metadataActions(), applyAppServerMetadata: vi.fn() };

    applyCachedSharedAppServerState(
      {
        cachedThreadList: () => null,
        cachedAppServerMetadata: () => null,
      },
      serverThreads,
      serverMetadata,
    );

    expect(serverThreads.applyThreadList).not.toHaveBeenCalled();
    expect(serverMetadata.applyAppServerMetadata).not.toHaveBeenCalled();
  });

  it("applies cached thread lists, including empty ready snapshots, and metadata independently when present", () => {
    const threads: Thread[] = [];
    const metadata = metadataSnapshot();
    const serverThreads = { applyThreadList: vi.fn(), loadThreadList: vi.fn(), startThread: vi.fn() };
    const serverMetadata = { ...metadataActions(), applyAppServerMetadata: vi.fn() };

    applyCachedSharedAppServerState(
      {
        cachedThreadList: () => threads,
        cachedAppServerMetadata: () => metadata,
      },
      serverThreads,
      serverMetadata,
    );

    expect(serverThreads.applyThreadList).toHaveBeenCalledWith(threads);
    expect(serverMetadata.applyAppServerMetadata).toHaveBeenCalledWith(metadata);
  });
});

function metadataActions() {
  return {
    serverMetadataSnapshot: vi.fn(),
    loadAppServerMetadata: vi.fn(),
    refreshAppServerMetadata: vi.fn(),
    refreshPublishedAppServerMetadata: vi.fn(),
    publishAppServerMetadataSnapshot: vi.fn(),
    refreshModels: vi.fn(),
    loadModels: vi.fn(),
    refreshSkills: vi.fn(),
    refreshPublishedSkills: vi.fn(),
    loadSkills: vi.fn(),
    refreshRateLimits: vi.fn(),
    refreshPublishedRateLimits: vi.fn(),
    loadRateLimit: vi.fn(),
  };
}

function metadataSnapshot(): SharedServerMetadata {
  return {
    runtimeConfig: emptyRuntimeConfigSnapshot(),
    availableModels: [],
    availableSkills: [],
    rateLimit: null,
    serverDiagnostics: createServerDiagnostics(),
  };
}
