// @vitest-environment jsdom

import type { ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { diagnosticProbeError, diagnosticProbeOk } from "../../../../../src/domain/server/diagnostics";
import type { SkillsMetadataResource } from "../../../../../src/domain/server/metadata";
import type { Thread } from "../../../../../src/domain/threads/model";
import {
  type ChatSharedDisplayQueries,
  useActiveThreadsResource,
  useSkillsResource,
} from "../../../../../src/features/chat/panel/shell/shared-resource-hooks";
import type { ThreadCatalogPaginatedActiveReader } from "../../../../../src/features/threads/catalog/thread-catalog";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import type { ObservedPaginatedResult } from "../../../../../src/shared/runtime/observed-result";

describe("shared display resource hooks", () => {
  it("subscribes panels directly to requested resources while retaining last-known-good values", async () => {
    const skillListeners = new Set<(resource: SkillsMetadataResource) => void>();
    const threadListeners = new Set<(result: ObservedPaginatedResult<readonly Thread[]>) => void>();
    const queries = queriesWithSkills(skillListeners);
    const catalog = catalogWithListeners(threadListeners);
    const first = document.createElement("div");
    const second = document.createElement("div");

    await act(async () => {
      renderUiRoot(first, <SharedValues queries={queries} catalog={catalog} />);
      renderUiRoot(second, <SharedValues queries={queries} catalog={catalog} />);
    });
    expect(skillListeners.size).toBe(2);
    expect(threadListeners.size).toBe(2);
    expect(queries.observeModelsResource).not.toHaveBeenCalled();

    await act(async () => {
      for (const listener of threadListeners) listener(threadResult([thread("thread")]));
      for (const listener of skillListeners) {
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
      for (const listener of threadListeners) listener({ ...threadResult([thread("thread")]), error: new Error("threads offline") });
      for (const listener of skillListeners) {
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
    expect(skillListeners.size).toBe(1);
    expect(threadListeners.size).toBe(1);
    expect(second.textContent).toBe("thread|writer|failed|threads offline");

    unmountUiRoot(second);
  });

  it("invalidates displayed values when the execution-context sources change", async () => {
    const firstSkills = new Set<(resource: SkillsMetadataResource) => void>();
    const secondSkills = new Set<(resource: SkillsMetadataResource) => void>();
    const first = sharedSources(firstSkills);
    const second = sharedSources(secondSkills);
    const parent = document.createElement("div");

    await act(async () => {
      renderUiRoot(parent, <SharedValues queries={first.queries} catalog={first.catalog} />);
      for (const listener of firstSkills) {
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
    expect(firstSkills.size).toBe(0);
    expect(secondSkills.size).toBe(1);
    unmountUiRoot(parent);
  });
});

function queriesWithSkills(skillListeners: Set<(resource: SkillsMetadataResource) => void>): ChatSharedDisplayQueries {
  return {
    observeRuntimeConfigResource: vi.fn(() => () => undefined),
    observeModelsResource: vi.fn(() => () => undefined),
    observeSkillsResource: (listener) => {
      skillListeners.add(listener);
      return () => {
        skillListeners.delete(listener);
      };
    },
    observePermissionProfilesResource: vi.fn(() => () => undefined),
    observeRateLimitsResource: vi.fn(() => () => undefined),
  };
}

function catalogWithListeners(
  threadListeners: Set<(result: ObservedPaginatedResult<readonly Thread[]>) => void>,
): ThreadCatalogPaginatedActiveReader {
  return {
    observeActiveThreadsResult: (listener: (result: ObservedPaginatedResult<readonly Thread[]>) => void) => {
      threadListeners.add(listener);
      return () => {
        threadListeners.delete(listener);
      };
    },
  } as unknown as ThreadCatalogPaginatedActiveReader;
}

function sharedSources(skillListeners: Set<(resource: SkillsMetadataResource) => void>): {
  queries: ChatSharedDisplayQueries;
  catalog: ThreadCatalogPaginatedActiveReader;
} {
  return {
    queries: queriesWithSkills(skillListeners),
    catalog: {
      observeActiveThreadsResult: () => () => undefined,
    } as unknown as ThreadCatalogPaginatedActiveReader,
  };
}

function SharedValues({
  queries,
  catalog,
}: {
  queries: ChatSharedDisplayQueries;
  catalog: ThreadCatalogPaginatedActiveReader;
}): ComponentChild {
  const threads = useActiveThreadsResource(catalog);
  const skills = useSkillsResource(queries);
  return [
    threads.threads.map((item) => item.id).join(","),
    skills.value.map((skill) => skill.name).join(","),
    skills.probe.status,
    threads.error ?? "",
  ].join("|");
}

function threadResult(value: readonly Thread[]): ObservedPaginatedResult<readonly Thread[]> {
  return {
    value,
    isFetching: false,
    isFetchingNextPage: false,
    hasMore: false,
    error: null,
  };
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
