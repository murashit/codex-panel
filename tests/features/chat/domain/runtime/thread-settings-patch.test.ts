import { describe, expect, it } from "vitest";
import {
  resetRuntimeIntentToConfig,
  setCollaborationModeIntent,
  setRuntimeIntentValue,
} from "../../../../../src/features/chat/domain/runtime/intent";
import {
  pendingRuntimeSettingsPatch,
  permissionProfileRequestForThreadStart,
  serviceTierRequestForThreadStart,
} from "../../../../../src/features/chat/domain/runtime/thread-settings-patch";
import { runtimeConfigFromAppServerFixture } from "../../../../support/runtime-config";
import { modelFixture, runtimeSnapshot, snapshotConfig } from "./support";

describe("runtime thread settings patch", () => {
  it("sends the pending permission profile without copying reported permissions", () => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: {
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        activePermissionProfile: null,
      },
      pending: {
        permissionProfile: setRuntimeIntentValue(":workspace"),
      },
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).toEqual({ permissions: ":workspace" });
  });

  it("omits an unsupported permission reset when config only defines a legacy sandbox", () => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      runtimeConfig: runtimeConfigFromAppServerFixture({
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: {
          writable_roots: ["/vault"],
          network_access: false,
          exclude_tmpdir_env_var: false,
          exclude_slash_tmp: false,
        },
      }),
      active: {
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        activePermissionProfile: { id: ":workspace", extends: null },
        sandboxPolicy: null,
      },
      pending: { permissionProfile: resetRuntimeIntentToConfig() },
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).toEqual({});
  });

  it("selects config permission profiles for empty-panel thread starts", () => {
    const configured = runtimeSnapshot({
      runtimeConfig: runtimeConfigFromAppServerFixture({
        default_permissions: ":workspace",
      }),
    });

    expect(permissionProfileRequestForThreadStart(configured, snapshotConfig(configured))).toBe(":workspace");

    const pending = runtimeSnapshot({
      runtimeConfig: runtimeConfigFromAppServerFixture({
        default_permissions: ":workspace",
      }),
      pending: { permissionProfile: setRuntimeIntentValue(":read-only") },
    });

    expect(permissionProfileRequestForThreadStart(pending, snapshotConfig(pending))).toBe(":read-only");

    const legacySandbox = runtimeSnapshot({
      runtimeConfig: runtimeConfigFromAppServerFixture({
        sandbox_mode: "workspace-write",
      }),
    });

    expect(permissionProfileRequestForThreadStart(legacySandbox, snapshotConfig(legacySandbox))).toBeUndefined();
  });

  it("sends configured model and effort values for reset intents", () => {
    const snapshot = runtimeSnapshot({
      pending: {
        model: resetRuntimeIntentToConfig(),
        reasoningEffort: resetRuntimeIntentToConfig(),
      },
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: "gpt-5.5", effort: "high" },
      collaborationModeWarning: null,
    });
  });

  it("projects explicit runtime intents into settings payload values", () => {
    const snapshot = runtimeSnapshot({
      pending: {
        model: setRuntimeIntentValue("gpt-5.4"),
        reasoningEffort: setRuntimeIntentValue("low"),
      },
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: "gpt-5.4", effort: "low" },
      collaborationModeWarning: null,
    });
  });

  it("omits reported runtime settings when no change is requested", () => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: { model: "gpt-5-active", serviceTier: "fast", collaborationMode: null },
      runtimeConfig: runtimeConfigFromAppServerFixture({}),
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toEqual({
      update: {},
      intents: {},
      collaborationModeWarning: null,
    });
  });

  it("keeps model reset tied to config when active thread model differs", () => {
    const snapshot = runtimeSnapshot({
      active: { model: "gpt-5-active" },
      pending: { model: resetRuntimeIntentToConfig() },
      runtimeConfig: runtimeConfigFromAppServerFixture({
        model_reasoning_effort: "high",
        service_tier: "flex",
        model_context_window: 100_000,
      }),
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toEqual({
      update: {},
      intents: {},
      collaborationModeWarning: null,
    });
  });

  it("builds the Plan collaboration mode payload from selected runtime settings", () => {
    const snapshot = runtimeSnapshot({
      pending: {
        collaborationMode: setCollaborationModeIntent("plan"),
        model: setRuntimeIntentValue("gpt-5.5"),
        reasoningEffort: setRuntimeIntentValue("high"),
      },
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: {
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.5",
            reasoningEffort: "high",
            developerInstructions: null,
          },
        },
      },
      collaborationModeWarning: null,
    });
  });

  it("preserves other settings while warning that Plan mode has no effective model", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFromAppServerFixture({}),
      pending: {
        collaborationMode: setCollaborationModeIntent("plan"),
        approvalsReviewer: setRuntimeIntentValue("auto_review"),
      },
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { approvalsReviewer: "auto_review" },
      collaborationModeWarning: "missing-model",
    });
  });

  it("uses the explicit config for collaboration mode thread settings", () => {
    const snapshot = runtimeSnapshot({
      pending: { collaborationMode: setCollaborationModeIntent("plan") },
      runtimeConfig: runtimeConfigFromAppServerFixture({
        model: "snapshot-model",
        model_reasoning_effort: "low",
      }),
    });
    const explicitConfig = runtimeConfigFromAppServerFixture({
      model: "explicit-model",
      model_reasoning_effort: "high",
    });

    expect(pendingRuntimeSettingsPatch(snapshot, explicitConfig)).toMatchObject({
      update: {
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "explicit-model",
            reasoningEffort: "high",
            developerInstructions: null,
          },
        },
      },
      collaborationModeWarning: null,
    });
  });

  it("keeps collaboration mode settings separate from reviewer and direct runtime intents", () => {
    const reviewerSnapshot = runtimeSnapshot({
      pending: {
        collaborationMode: setCollaborationModeIntent("plan"),
        approvalsReviewer: setRuntimeIntentValue("auto_review"),
      },
    });
    const activeRuntimeSnapshot = runtimeSnapshot({
      pending: { collaborationMode: setCollaborationModeIntent("plan") },
      active: { model: "gpt-5-active", serviceTier: "fast" },
      runtimeConfig: runtimeConfigFromAppServerFixture({}),
    });

    expect(pendingRuntimeSettingsPatch(reviewerSnapshot, snapshotConfig(reviewerSnapshot))).toMatchObject({
      update: {
        approvalsReviewer: "auto_review",
        collaborationMode: {
          mode: "plan",
          settings: { model: "gpt-5.5", reasoningEffort: "high" },
        },
      },
    });
    expect(
      pendingRuntimeSettingsPatch(reviewerSnapshot, snapshotConfig(reviewerSnapshot)).update.collaborationMode?.settings,
    ).not.toHaveProperty("approvalsReviewer");
    expect(pendingRuntimeSettingsPatch(activeRuntimeSnapshot, snapshotConfig(activeRuntimeSnapshot))).toMatchObject({
      update: {
        collaborationMode: {
          mode: "plan",
          settings: { model: "gpt-5-active" },
        },
      },
    });
    expect(pendingRuntimeSettingsPatch(activeRuntimeSnapshot, snapshotConfig(activeRuntimeSnapshot)).update).not.toHaveProperty("model");
    expect(pendingRuntimeSettingsPatch(activeRuntimeSnapshot, snapshotConfig(activeRuntimeSnapshot)).update).not.toHaveProperty("effort");
  });

  it("projects the requested approval reviewer into thread settings", () => {
    const snapshot = runtimeSnapshot({ pending: { approvalsReviewer: setRuntimeIntentValue("auto_review") } });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { approvalsReviewer: "auto_review" },
    });
  });

  it("serializes disabled Fast mode as a null service tier request", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFromAppServerFixture({ service_tier: "fast" }),
      pending: { fastMode: setRuntimeIntentValue("disabled") },
    });

    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeNull();
  });

  it("serializes requested fast mode using the catalog Fast service tier id", () => {
    const model = {
      ...modelFixture("gpt-5.5"),
      serviceTiers: [{ id: "priority", name: "Fast" }],
    };
    const snapshot = runtimeSnapshot({
      pending: { fastMode: setRuntimeIntentValue("enabled") },
      runtimeConfig: runtimeConfigFromAppServerFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("priority");
  });

  it("omits service tier when neither config nor pending intent selects one", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFromAppServerFixture({}) });

    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeUndefined();
  });

  it("passes through configured non-fast service tier ids", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFromAppServerFixture({ service_tier: "flex" }) });

    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("flex");
  });
});
