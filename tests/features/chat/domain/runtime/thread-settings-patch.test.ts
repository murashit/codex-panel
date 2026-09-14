import { describe, expect, it } from "vitest";
import {
  resetRuntimeIntentToConfig,
  setCollaborationModeIntent,
  setRuntimeIntentValue,
} from "../../../../../src/features/chat/domain/runtime/intent";
import { resolveRuntimeControls } from "../../../../../src/features/chat/domain/runtime/resolution";
import {
  pendingRuntimeSettingsPatch,
  permissionProfileRequestForThreadStart,
  serviceTierRequestForThreadStart,
} from "../../../../../src/features/chat/domain/runtime/thread-settings-patch";
import { modelFixture, runtimeConfigFixture, runtimeSnapshot, snapshotConfig } from "./support";

describe("runtime thread settings patch", () => {
  it("keeps permission display scope separate from pending permission source", () => {
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
        approvalPolicy: setRuntimeIntentValue("never"),
        permissionProfile: setRuntimeIntentValue(":workspace"),
      },
    });

    expect(resolveRuntimeControls(snapshot, snapshotConfig(snapshot))).toMatchObject({
      permissionProfile: { effective: ":workspace", source: "pending" },
      sandboxPolicy: { effective: null, source: "pending" },
      approvalPolicy: { effective: "never", source: "pending" },
    });
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: {
        approvalPolicy: "never",
        permissions: ":workspace",
      },
    });
  });

  it("resolves permission profile reset intent back to legacy sandbox config", () => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      runtimeConfig: runtimeConfigFixture({
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

    expect(resolveRuntimeControls(snapshot, snapshotConfig(snapshot))).toMatchObject({
      permissionProfile: { effective: null, source: "config" },
      sandboxPolicy: {
        effective: {
          type: "workspaceWrite",
          writableRoots: ["/vault"],
          networkAccess: false,
        },
        source: "config",
      },
    });
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { permissions: null },
    });
  });

  it("selects config permission profiles for empty-panel thread starts", () => {
    const configured = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({
        default_permissions: ":workspace",
      }),
    });

    expect(permissionProfileRequestForThreadStart(configured, snapshotConfig(configured))).toBe(":workspace");

    const pending = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({
        default_permissions: ":workspace",
      }),
      pending: { permissionProfile: setRuntimeIntentValue(":read-only") },
    });

    expect(permissionProfileRequestForThreadStart(pending, snapshotConfig(pending))).toBe(":read-only");

    const legacySandbox = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({
        sandbox_mode: "workspace-write",
      }),
    });

    expect(permissionProfileRequestForThreadStart(legacySandbox, snapshotConfig(legacySandbox))).toBeUndefined();
  });

  it("resolves model and effort resets from config while serializing null", () => {
    const snapshot = runtimeSnapshot({
      pending: {
        model: resetRuntimeIntentToConfig(),
        reasoningEffort: resetRuntimeIntentToConfig(),
      },
    });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.model.effective).toBe("gpt-5.5");
    expect(resolution.reasoningEffort.effective).toBe("high");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: null, effort: null },
      collaborationModeWarning: null,
    });
  });

  it("projects explicit runtime intents into current values and settings payload values", () => {
    const snapshot = runtimeSnapshot({
      pending: {
        model: setRuntimeIntentValue("gpt-5.4"),
        reasoningEffort: setRuntimeIntentValue("low"),
      },
    });
    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.model).toMatchObject({ effective: "gpt-5.4", source: "pending" });
    expect(resolution.reasoningEffort).toMatchObject({ effective: "low", source: "pending" });
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: "gpt-5.4", effort: "low" },
      collaborationModeWarning: null,
    });
  });

  it("omits collaboration mode settings when the thread has not reported a mode and no change is requested", () => {
    const snapshot = runtimeSnapshot({
      active: { collaborationMode: null },
    });

    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toEqual({
      update: {},
      collaborationModeWarning: null,
    });
  });

  it("keeps model reset tied to config when active thread model differs", () => {
    const snapshot = runtimeSnapshot({
      active: { model: "gpt-5-active" },
      pending: { model: resetRuntimeIntentToConfig() },
      runtimeConfig: runtimeConfigFixture({
        model_reasoning_effort: "high",
        service_tier: "flex",
        model_context_window: 100_000,
      }),
    });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.model.effective).toBeNull();
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: null },
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

  it("uses the explicit config for collaboration mode thread settings", () => {
    const snapshot = runtimeSnapshot({
      pending: { collaborationMode: setCollaborationModeIntent("plan") },
      runtimeConfig: runtimeConfigFixture({
        model: "snapshot-model",
        model_reasoning_effort: "low",
      }),
    });
    const explicitConfig = runtimeConfigFixture({
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
      runtimeConfig: runtimeConfigFixture({}),
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

  it("projects the requested approval reviewer into display and thread settings", () => {
    const snapshot = runtimeSnapshot({ pending: { approvalsReviewer: setRuntimeIntentValue("auto_review") } });
    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.autoReview).toMatchObject({ active: true, confirmedActive: false, source: "pending", confirmedSource: "none" });
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { approvalsReviewer: "auto_review" },
    });
  });

  it("treats active thread runtime as display state without persisting it into runtime intent patches", () => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: { model: "gpt-5-active", serviceTier: "fast" },
      runtimeConfig: runtimeConfigFixture({}),
    });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.model.effective).toBe("gpt-5-active");
    expect(resolution.serviceTier.effective).toBe("fast");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).not.toHaveProperty("model");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).not.toHaveProperty("effort");
  });

  it("serializes disabled Fast mode as a null service tier request", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
      pending: { fastMode: setRuntimeIntentValue("disabled") },
    });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.serviceTier.effective).toBeNull();
    expect(resolution.fastMode.active).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeNull();
  });

  it("serializes service tier reset for thread start as the configured tier instead of null", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
      pending: { fastMode: resetRuntimeIntentToConfig() },
    });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.serviceTier.effective).toBe("fast");
    expect(resolution.fastMode.active).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("fast");
  });

  it("omits service tier reset for thread start when config has no service tier", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({}),
      pending: { fastMode: resetRuntimeIntentToConfig() },
    });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.serviceTier.effective).toBeNull();
    expect(resolution.fastMode.active).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeUndefined();
  });

  it("serializes requested fast mode using the catalog Fast service tier id", () => {
    const model = {
      ...modelFixture("gpt-5.5"),
      serviceTiers: [{ id: "priority", name: "Fast" }],
    };
    const snapshot = runtimeSnapshot({
      pending: { fastMode: setRuntimeIntentValue("enabled") },
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.serviceTier.effective).toBe("priority");
    expect(resolution.fastMode).toMatchObject({
      active: true,
      effectiveServiceTier: "priority",
      serviceTierRequestValue: "priority",
    });
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("priority");
  });

  it("omits service tier when neither config nor pending intent selects one", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFixture({}) });

    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeUndefined();
  });

  it("passes through configured non-fast service tier ids", () => {
    const snapshot = runtimeSnapshot({ runtimeConfig: runtimeConfigFixture({ service_tier: "flex" }) });

    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(resolution.serviceTier.effective).toBe("flex");
    expect(resolution.fastMode.active).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("flex");
  });
});
