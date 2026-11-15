import { onTestFinished } from "vitest";
import { BUILT_IN_PINNED_THREAD_SECTION_ID } from "../../src/app-server/protocol/thread";
import { AppServerQueryScope } from "../../src/app-server/query/query-scope";
import { ThreadCatalog } from "../../src/app-server/query/thread-catalog-queries";
import type { ThreadFact } from "../../src/domain/threads/facts";
import type { Thread } from "../../src/domain/threads/model";

export function threadCatalogFixture(
  read: (archived: boolean) => Promise<readonly Thread[]>,
  onPublishedFacts?: (facts: readonly ThreadFact[]) => void,
) {
  const scope = new AppServerQueryScope(
    { codexPath: "codex", vaultPath: "/vault" },
    {
      withClient: async (operation) =>
        operation({
          request: async (method: string, params: { archived?: boolean; sectionId?: string }) => {
            if (method !== "thread/list") throw new Error(`Unexpected request: ${method}`);
            return {
              data: params.sectionId === BUILT_IN_PINNED_THREAD_SECTION_ID ? [] : await read(params.archived ?? false),
              nextCursor: null,
            };
          },
        } as never),
    },
  );
  onTestFinished(() => scope.dispose());
  return { scope, catalog: new ThreadCatalog(scope, onPublishedFacts) };
}
