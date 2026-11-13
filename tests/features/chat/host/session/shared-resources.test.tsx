// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { expect, it, onTestFinished, vi } from "vitest";
import { AppServerMetadataQueries } from "../../../../../src/app-server/query/metadata-queries";
import { AppServerQueryScope } from "../../../../../src/app-server/query/query-scope";
import { AppServerToolInventoryQueries } from "../../../../../src/app-server/query/tool-inventory-queries";
import { createChatRuntimeSettingsCommands } from "../../../../../src/features/chat/application/runtime/settings-commands";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { resolveRuntimeControls } from "../../../../../src/features/chat/domain/runtime/resolution";
import { createSessionSharedResources, type SessionSharedResources } from "../../../../../src/features/chat/host/session/shared-resources";
import { useModelsResource } from "../../../../../src/features/chat/host/shell/shared-resource-hooks";
import { createKeyedOperationCoordinator } from "../../../../../src/shared/async/keyed-operation-coordinator";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/preact-root.dom";
import { deferred } from "../../../../support/async";
import { modelMetadataFixture } from "../../../../support/model-metadata";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { chatSharedSourcesFixture } from "../../support/shared-sources";

it("shares the session catalog with its display and model action while isolating other panels and failed restores", async () => {
  let providerAModel = "A-only";
  const pending = deferred<{ data: ReturnType<typeof modelMetadataFixture>[] }>();
  const listModels = vi.fn((provider?: string) =>
    provider === "C"
      ? pending.promise
      : Promise.resolve({
          data: [
            modelMetadataFixture(
              "shared",
              provider === "A"
                ? { serviceTiers: [{ id: "priority", name: "Fast" }] }
                : {
                    supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }],
                    defaultReasoningEffort: "low",
                  },
            ),
            modelMetadataFixture(provider === "A" ? providerAModel : `${provider ?? "B"}-only`),
          ],
        }),
  );
  // Only the app-server transport is doubled; query ownership, session routing, display and commands are real.
  const scope = new AppServerQueryScope(
    { codexPath: "codex", vaultPath: "/vault" },
    {
      withClient: async (operation) =>
        operation({ request: async (_method: string, params: { modelProvider?: string }) => listModels(params.modelProvider) } as never),
    },
  );
  const queries = new AppServerMetadataQueries(scope);
  const makePanel = () => {
    const store = createChatStateStore();
    const resources = createSessionSharedResources(
      {
        appServerQueries: queries,
        threadCatalog: chatSharedSourcesFixture().threadCatalog,
        toolInventoryQueries: new AppServerToolInventoryQueries(scope),
      },
      store,
    );
    const root = document.createElement("div");
    const resume = (provider: string) =>
      store.dispatch({
        type: "active-thread/resumed",
        ...threadActivationFixture(panelThreadFixture({ id: `thread-${provider}` }), {
          model: "shared",
          modelProvider: provider,
          reasoningEffort: "high",
        }),
      });
    onTestFinished(() => {
      unmountUiRoot(root);
      resources.dispose();
    });
    return { store, resources, root, resume };
  };
  onTestFinished(() => scope.dispose());
  await queries.fetchModels();
  const first = makePanel();
  const second = makePanel();
  await act(async () => {
    renderUiRoot(first.root, <ModelsValue source={first.resources} />);
    renderUiRoot(second.root, <ModelsValue source={second.resources} />);
  });
  expect(first.root.textContent).toBe("shared,B-only|ok");
  await act(async () => {
    first.resume("A");
    second.resume("B");
  });
  await vi.waitFor(() => expect(first.root.textContent).toBe("shared,A-only|ok"));
  expect(second.root.textContent).toBe("shared,B-only|ok");

  const snapshot = () => runtimeSnapshotForChatState(first.store.getState(), first.resources);
  expect(resolveRuntimeControls(snapshot(), runtimeConfigFixture({ modelProvider: "B" }))).toMatchObject({
    supportedReasoningEfforts: ["high"],
    fastMode: { available: true },
  });
  const updateThreadSettings = vi.fn().mockResolvedValue({ kind: "accepted" });
  const commands = createChatRuntimeSettingsCommands(
    {
      stateStore: first.store,
      runtimeSettingsPort: { updateThreadSettings },
      runtimeSnapshotForState: snapshot,
      collaborationModeLabel: () => "Default",
      addSystemMessage: () => {},
    },
    createKeyedOperationCoordinator({ whenBusy: "queue" }),
  );
  await commands.requestModel("shared");
  expect(updateThreadSettings).toHaveBeenCalledExactlyOnceWith("thread-A", { model: "shared" });
  expect(first.store.getState().runtime.active.reasoningEffort).toBe("high");

  // Reconnect can invalidate a fork draft's catalog while retaining the same provider.
  providerAModel = "A-refreshed";
  scope.invalidate();
  await act(async () => {
    await first.resources.ensureModels();
  });
  expect(first.root.textContent).toBe("shared,A-refreshed|ok");
  expect(second.root.textContent).toBe("shared,B-only|ok");

  await act(async () => {
    first.store.dispatch({ type: "connection/scoped-cleared" });
  });
  expect(first.root.textContent).toBe("|unknown");
  expect(snapshot().availableModels).toEqual([]);
  await act(async () => {
    first.resume("C");
  });
  expect(first.root.textContent).toBe("|unknown");
  await act(async () => {
    pending.reject(new Error("C unavailable"));
    await pending.promise.catch(() => {});
  });
  await vi.waitFor(() => expect(first.root.textContent).toBe("|failed"));
  await expect(first.resources.ensureModels()).resolves.toBeUndefined();
  expect(snapshot().availableModels).toEqual([]);
  expect(second.root.textContent).toBe("shared,B-only|ok");
  await act(async () => {
    first.store.dispatch({ type: "panel/view-state-cleared" });
  });
  expect(first.root.textContent).toBe("shared,B-only|ok");
});

function ModelsValue({ source }: { source: SessionSharedResources }) {
  const models = useModelsResource(source);
  return `${models.value.map((model) => model.model).join(",")}|${models.probe.status}`;
}
