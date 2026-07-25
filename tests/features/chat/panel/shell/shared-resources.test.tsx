// @vitest-environment jsdom

import type { ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import { diagnosticProbeError, diagnosticProbeOk } from "../../../../../src/domain/server/diagnostics";
import type { SharedServerMetadataResource } from "../../../../../src/domain/server/metadata";
import type { Thread } from "../../../../../src/domain/threads/model";
import { type ChatSharedResourceQueries, useChatSharedResources } from "../../../../../src/features/chat/panel/shell/shared-resources";
import type { ThreadCatalogPaginatedActiveReader } from "../../../../../src/features/threads/catalog/thread-catalog";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import type { ObservedPaginatedResult } from "../../../../../src/shared/runtime/observed-result";

describe("useChatSharedResources", () => {
  it("projects one shared read model to multiple panels while retaining last-known-good values", async () => {
    const metadataListeners = new Set<(resource: SharedServerMetadataResource) => void>();
    const threadListeners = new Set<(result: ObservedPaginatedResult<readonly Thread[]>) => void>();
    const queries: ChatSharedResourceQueries = {
      observeAppServerMetadataResources: (listener) => {
        metadataListeners.add(listener);
        return () => {
          metadataListeners.delete(listener);
        };
      },
    };
    const catalog = {
      observeActiveThreadsResult: (listener: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
        threadListeners.add(listener);
        return () => {
          threadListeners.delete(listener);
        };
      },
    } as unknown as ThreadCatalogPaginatedActiveReader;
    const first = document.createElement("div");
    const second = document.createElement("div");

    await act(async () => {
      renderUiRoot(first, <SharedValues queries={queries} catalog={catalog} />);
      renderUiRoot(second, <SharedValues queries={queries} catalog={catalog} />);
    });
    expect(metadataListeners.size).toBe(2);
    expect(threadListeners.size).toBe(2);

    await act(async () => {
      for (const listener of threadListeners) {
        listener({
          value: [thread("thread")],
          isFetching: false,
          isFetchingNextPage: false,
          hasMore: false,
          error: null,
        });
      }
      for (const listener of metadataListeners) {
        listener({
          id: "skills",
          value: [{ name: "writer", description: "", path: "/skills/writer", enabled: true }],
          probe: diagnosticProbeOk("skills", "1 skill", 1),
        });
      }
    });

    expect(first.textContent).toBe("thread|writer|ok|");
    expect(second.textContent).toBe(first.textContent);

    await act(async () => {
      for (const listener of threadListeners) {
        listener({
          value: [thread("thread")],
          isFetching: false,
          isFetchingNextPage: false,
          hasMore: false,
          error: new Error("threads offline"),
        });
      }
      for (const listener of metadataListeners) {
        listener({
          id: "skills",
          value: undefined,
          probe: diagnosticProbeError("skills", new Error("skills offline"), 2),
        });
      }
    });

    expect(first.textContent).toBe("thread|writer|failed|threads offline");
    expect(second.textContent).toBe(first.textContent);

    await act(async () => {
      unmountUiRoot(first);
    });
    expect(metadataListeners.size).toBe(1);
    expect(threadListeners.size).toBe(1);
    expect(second.textContent).toBe("thread|writer|failed|threads offline");

    unmountUiRoot(second);
  });

  it("invalidates displayed values when the execution-context sources change", async () => {
    const firstMetadata = new Set<(resource: SharedServerMetadataResource) => void>();
    const secondMetadata = new Set<(resource: SharedServerMetadataResource) => void>();
    const first = sharedSources(firstMetadata);
    const second = sharedSources(secondMetadata);
    const parent = document.createElement("div");

    await act(async () => {
      renderUiRoot(parent, <SharedValues queries={first.queries} catalog={first.catalog} />);
      for (const listener of firstMetadata) {
        listener({
          id: "skills",
          value: [{ name: "old-context", description: "", path: "/old", enabled: true }],
          probe: diagnosticProbeOk("skills", "1 skill", 1),
        });
      }
    });
    expect(parent.textContent).toContain("old-context");

    await act(async () => {
      renderUiRoot(parent, <SharedValues queries={second.queries} catalog={second.catalog} />);
    });

    expect(parent.textContent).toBe("||unknown|");
    expect(firstMetadata.size).toBe(0);
    expect(secondMetadata.size).toBe(1);
    unmountUiRoot(parent);
  });
});

function sharedSources(metadataListeners: Set<(resource: SharedServerMetadataResource) => void>): {
  queries: ChatSharedResourceQueries;
  catalog: ThreadCatalogPaginatedActiveReader;
} {
  return {
    queries: {
      observeAppServerMetadataResources: (listener) => {
        metadataListeners.add(listener);
        return () => {
          metadataListeners.delete(listener);
        };
      },
    },
    catalog: {
      observeActiveThreadsResult: () => () => undefined,
    } as unknown as ThreadCatalogPaginatedActiveReader,
  };
}

function SharedValues({
  queries,
  catalog,
}: {
  queries: ChatSharedResourceQueries;
  catalog: ThreadCatalogPaginatedActiveReader;
}): ComponentChild {
  const shared = useChatSharedResources(queries, catalog);
  return [
    shared.threads.map((item) => item.id).join(","),
    shared.availableSkills.map((skill) => skill.name).join(","),
    shared.metadataDiagnostics.probes.skills.status,
    shared.threadListError ?? "",
  ].join("|");
}

function thread(id: string): Thread {
  return {
    id,
    preview: id,
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    provenance: { kind: "interactive" },
  };
}
