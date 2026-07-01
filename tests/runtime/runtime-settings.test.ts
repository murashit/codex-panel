import { describe, expect, it } from "vitest";

import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../src/domain/runtime/config";
import {
  resetRuntimeIntentToConfig,
  setCollaborationModeIntent,
  setRuntimeIntentValue,
  unchangedCollaborationModeIntent,
} from "../../src/features/chat/domain/runtime/intent";
import {
  compactReasoningEffortLabel,
  modelOverrideMessage,
  reasoningEffortOverrideMessage,
} from "../../src/features/chat/domain/runtime/labels";
import { resolveRuntimeControls } from "../../src/features/chat/domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../src/features/chat/domain/runtime/snapshot";
import {
  pendingRuntimeSettingsPatch,
  serviceTierRequestForThreadStart,
} from "../../src/features/chat/domain/runtime/thread-settings-patch";
import { contextSummary, rateLimitSummary } from "../../src/features/chat/presentation/runtime/status";

describe("runtime settings", () => {
  it("formats runtime override messages", () => {
    expect(modelOverrideMessage("gpt-5.5")).toBe("Model set to gpt-5.5 for subsequent turns.");
    expect(modelOverrideMessage(null)).toBe("Model reset to default for subsequent turns.");
    expect(reasoningEffortOverrideMessage("low")).toBe("Reasoning effort set to low for subsequent turns.");
    expect(reasoningEffortOverrideMessage(null)).toBe("Reasoning effort reset to default for subsequent turns.");
  });

  it("formats compact runtime labels", () => {
    expect(compactReasoningEffortLabel("minimal")).toBe("min");
    expect(compactReasoningEffortLabel("high")).toBe("high");
    expect(compactReasoningEffortLabel(null)).toBe("default");
  });

  it("keeps startup permission defaults in the runtime config snapshot", () => {
    expect(
      runtimeConfigFixture({
        default_permissions: ":workspace",
        approval_policy: "on-request",
        approvals_reviewer: "auto_review",
      }),
    ).toMatchObject({
      approvalsReviewer: "auto_review",
      startupPermissions: {
        activePermissionProfile: { id: ":workspace", extends: null },
        approvalPolicy: "on-request",
        sandboxPolicy: null,
      },
    });
  });

  it("deep-clones granular startup approval policy in runtime config snapshots", () => {
    const config = runtimeConfigFixture({
      approval_policy: {
        granular: {
          sandbox_approval: true,
          rules: false,
          skill_approval: true,
          request_permissions: false,
          mcp_elicitations: true,
        },
      },
    });

    const cloned = runtimeConfigOrDefault(config);
    const originalPolicy = config.startupPermissions.approvalPolicy;
    const clonedPolicy = cloned.startupPermissions.approvalPolicy;

    expect(clonedPolicy).toEqual(originalPolicy);
    if (!originalPolicy || typeof originalPolicy === "string" || !clonedPolicy || typeof clonedPolicy === "string") {
      throw new Error("expected granular approval policy");
    }
    expect(clonedPolicy).not.toBe(originalPolicy);
    expect(clonedPolicy.granular).not.toBe(originalPolicy.granular);
  });

  it("uses legacy sandbox config instead of default permissions when both are reported", () => {
    expect(
      runtimeConfigFixture({
        default_permissions: ":workspace",
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: {
          writable_roots: ["/vault"],
          network_access: false,
          exclude_tmpdir_env_var: false,
          exclude_slash_tmp: false,
        },
      }),
    ).toMatchObject({
      startupPermissions: {
        activePermissionProfile: null,
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/vault"],
          networkAccess: false,
        },
      },
    });
  });

  it("falls back to startup permissions until active thread permissions are reported", () => {
    const configured = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({
        default_permissions: ":workspace",
        approval_policy: "on-request",
      }),
    });
    expect(resolveRuntimeControls(configured, snapshotConfig(configured))).toMatchObject({
      permissionProfile: { effective: ":workspace", source: "config" },
      sandboxPolicy: { effective: null, source: "none" },
      approvalPolicy: { effective: "on-request", source: "config" },
    });

    const activeUnreported = runtimeSnapshot({
      activeThreadId: "thread",
      runtimeConfig: runtimeConfigFixture({
        default_permissions: ":workspace",
        approval_policy: "on-request",
      }),
    });
    expect(resolveRuntimeControls(activeUnreported, snapshotConfig(activeUnreported))).toMatchObject({
      permissionProfile: { configured: ":workspace", active: null, effective: ":workspace", source: "config" },
      sandboxPolicy: { configured: null, active: null, effective: null, source: "none" },
      approvalPolicy: { configured: "on-request", active: null, effective: "on-request", source: "config" },
    });

    const activeReported = runtimeSnapshot({
      activeThreadId: "thread",
      active: {
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        activePermissionProfile: { id: ":read-only", extends: null },
        approvalsReviewer: "user",
      },
      pending: { approvalsReviewer: setRuntimeIntentValue("auto_review") },
    });
    expect(resolveRuntimeControls(activeReported, snapshotConfig(activeReported))).toMatchObject({
      approvalsReviewer: { effective: "auto_review", source: "pending" },
      permissionProfile: { effective: ":read-only", source: "active-thread" },
      sandboxPolicy: { effective: { type: "readOnly", networkAccess: false }, source: "active-thread" },
      approvalPolicy: { effective: "never", source: "active-thread" },
    });

    const approvalOnlyReported = runtimeSnapshot({
      activeThreadId: "thread",
      runtimeConfig: runtimeConfigFixture({
        default_permissions: ":workspace",
        approval_policy: "on-request",
      }),
      active: {
        approvalPolicyKnown: true,
        approvalPolicy: "never",
      },
    });
    expect(resolveRuntimeControls(approvalOnlyReported, snapshotConfig(approvalOnlyReported))).toMatchObject({
      permissionProfile: { effective: ":workspace", source: "config" },
      sandboxPolicy: { effective: null, source: "none" },
      approvalPolicy: { effective: "never", source: "active-thread" },
    });
  });

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

  it("keeps runtime defaults, resets, and collaboration mode semantics distinct", () => {
    const snapshot = runtimeSnapshot({
      pending: {
        model: resetRuntimeIntentToConfig(),
        reasoningEffort: resetRuntimeIntentToConfig(),
      },
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-5.5");
    expect(currentReasoningEffort(snapshot, snapshotConfig(snapshot))).toBe("high");
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

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-5.4");
    expect(currentReasoningEffort(snapshot, snapshotConfig(snapshot))).toBe("low");
    expect(resolution.model).toMatchObject({ effective: "gpt-5.4", source: "pending" });
    expect(resolution.reasoningEffort).toMatchObject({ effective: "low", source: "pending" });
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toMatchObject({
      update: { model: "gpt-5.4", effort: "low" },
      collaborationModeWarning: null,
    });
  });

  it("treats unreported thread collaboration mode as default without losing the unknown state", () => {
    const snapshot = runtimeSnapshot({
      active: { collaborationMode: null },
    });

    expect(snapshot.active.collaborationMode).toBeNull();
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot))).toEqual({
      update: {},
      collaborationModeWarning: null,
    });

    expect(snapshot.pending.collaborationMode).toEqual({ kind: "unchanged" });
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

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBeNull();
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

  it("resolves auto-review mode from requested, active, then effective config", () => {
    const requested = runtimeSnapshot({
      pending: { approvalsReviewer: setRuntimeIntentValue("user") },
      active: { approvalsReviewer: "auto_review" },
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });
    const active = runtimeSnapshot({
      active: { approvalsReviewer: "user" },
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });
    const configured = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "guardian_subagent" }),
    });

    expect(autoReviewActive(requested, snapshotConfig(requested))).toBe(false);
    expect(autoReviewActive(active, snapshotConfig(active))).toBe(false);
    expect(autoReviewActive(configured, snapshotConfig(configured))).toBe(true);
  });

  it("uses the active reviewer before configured reviewer", () => {
    const snapshot = runtimeSnapshot({
      active: { approvalsReviewer: "user" },
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("treats guardian subagent reviewer as active auto-review", () => {
    const snapshot = runtimeSnapshot({
      active: { approvalsReviewer: "guardian_subagent" },
    });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
  });

  it("uses requested reviewer above active and configured reviewers", () => {
    const snapshot = runtimeSnapshot({
      pending: { approvalsReviewer: setRuntimeIntentValue("user") },
      active: { approvalsReviewer: "user" },
      runtimeConfig: runtimeConfigFixture({ approvals_reviewer: "auto_review" }),
    });

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("uses effective approval reviewer values and reports selected profile metadata", () => {
    const runtimeConfig = runtimeConfigFixture({ approvals_reviewer: "auto_review" }, [
      configLayer({}, null),
      configLayer({ approvals_reviewer: "auto_review" }, "auto"),
    ]);
    const snapshot = runtimeSnapshot({
      runtimeConfig,
    });

    expect(runtimeConfigOrDefault(runtimeConfig).profile).toBe("auto");
    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
  });

  it("uses effective model, effort, and fast mode config values", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture(
        {
          model: "gpt-profile",
          model_reasoning_effort: "high",
          service_tier: "fast",
        },
        [
          configLayer({}, null),
          configLayer({ model: "gpt-profile", model_reasoning_effort: "high", service_tier: "fast" }, "fast-profile"),
        ],
      ),
    });

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-profile");
    expect(currentReasoningEffort(snapshot, snapshotConfig(snapshot))).toBe("high");
    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("fast");
  });

  it("uses active service tier before configured service tier", () => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: { serviceTier: "flex" },
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
    });
    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("flex");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(resolution.serviceTier).toMatchObject({ effective: "flex", source: "active-thread" });
    expect(resolution.fastMode).toMatchObject({ active: false, source: "active-thread", effectiveServiceTier: "flex" });
  });

  it("treats the catalog Fast service tier id as fast mode while preserving the id", () => {
    const model = {
      ...modelFixture("gpt-5.5"),
      serviceTiers: [{ id: "priority", name: "Fast" }],
    };
    // app-server may advertise Fast with an id such as "priority";
    // last verified against codex app-server 0.142.0.
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: { model: "gpt-5.5", serviceTier: "priority" },
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("priority");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(fastRuntimeServiceTierRequestValue(snapshot, snapshotConfig(snapshot))).toBe("priority");
  });

  it("treats the app-server reported default tier after clearing Fast as fast mode off", () => {
    const model = {
      ...modelFixture("gpt-5.5"),
      serviceTiers: [{ id: "priority", name: "Fast" }],
    };
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: { model: "gpt-5.5", serviceTier: "default" },
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [model],
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("default");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
  });

  it("uses requested Fast mode above active and configured service tiers", () => {
    const snapshot = runtimeSnapshot({
      active: { serviceTier: "flex" },
      pending: { fastMode: setRuntimeIntentValue("disabled") },
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
    });
    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(resolution.serviceTier).toMatchObject({ effective: null, source: "pending" });
    expect(resolution.fastMode).toMatchObject({ active: false, source: "pending", effectiveServiceTier: null });
  });

  it("keeps a cleared active thread service tier above configured Fast mode", () => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: { serviceTier: null },
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
    });
    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(resolution.serviceTier).toMatchObject({ effective: null, source: "active-thread" });
  });

  it("resolves all runtime controls through pending, active, and config layers", () => {
    const configured = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({
        model: "gpt-config",
        model_reasoning_effort: "medium",
        default_permissions: ":workspace",
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
        sandbox_workspace_write: {
          writable_roots: ["/vault"],
          network_access: false,
          exclude_tmpdir_env_var: false,
          exclude_slash_tmp: false,
        },
        approvals_reviewer: "auto_review",
        service_tier: "fast",
      }),
    });
    const active = runtimeSnapshot({
      ...configured,
      activeThreadId: "thread",
      active: {
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        model: "gpt-active",
        reasoningEffort: "high",
        activePermissionProfile: { id: ":read-only", extends: null },
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        approvalPolicy: "never",
        approvalsReviewer: "user",
        serviceTier: "flex",
      },
    });
    const pending = runtimeSnapshot({
      ...active,
      pending: {
        ...active.pending,
        model: setRuntimeIntentValue("gpt-pending"),
        reasoningEffort: setRuntimeIntentValue("low"),
        permissionProfile: setRuntimeIntentValue(":workspace"),
        approvalPolicy: setRuntimeIntentValue("on-failure"),
        approvalsReviewer: setRuntimeIntentValue("guardian_subagent"),
        fastMode: setRuntimeIntentValue("enabled"),
      },
    });

    expect(resolveRuntimeControls(configured, snapshotConfig(configured))).toMatchObject({
      model: { effective: "gpt-config", source: "config" },
      reasoningEffort: { effective: "medium", source: "config" },
      permissionProfile: { effective: null, source: "none" },
      sandboxPolicy: { effective: { type: "workspaceWrite", writableRoots: ["/vault"], networkAccess: false }, source: "config" },
      approvalPolicy: { effective: "on-request", source: "config" },
      approvalsReviewer: { effective: "auto_review", source: "config" },
      serviceTier: { effective: "fast", source: "config" },
    });
    expect(resolveRuntimeControls(active, snapshotConfig(active))).toMatchObject({
      model: { effective: "gpt-active", source: "active-thread" },
      reasoningEffort: { effective: "high", source: "active-thread" },
      permissionProfile: { effective: ":read-only", source: "active-thread" },
      sandboxPolicy: { effective: { type: "readOnly", networkAccess: false }, source: "active-thread" },
      approvalPolicy: { effective: "never", source: "active-thread" },
      approvalsReviewer: { effective: "user", source: "active-thread" },
      serviceTier: { effective: "flex", source: "active-thread" },
    });
    expect(resolveRuntimeControls(pending, snapshotConfig(pending))).toMatchObject({
      model: { confirmed: "gpt-active", confirmedSource: "active-thread", effective: "gpt-pending", source: "pending" },
      reasoningEffort: { confirmed: "high", confirmedSource: "active-thread", effective: "low", source: "pending" },
      permissionProfile: { confirmed: ":read-only", confirmedSource: "active-thread", effective: ":workspace", source: "pending" },
      sandboxPolicy: {
        confirmed: { type: "readOnly", networkAccess: false },
        confirmedSource: "active-thread",
        effective: null,
        source: "pending",
      },
      approvalPolicy: { confirmed: "never", confirmedSource: "active-thread", effective: "on-failure", source: "pending" },
      approvalsReviewer: { confirmed: "user", confirmedSource: "active-thread", effective: "guardian_subagent", source: "pending" },
      serviceTier: { confirmed: "flex", confirmedSource: "active-thread", effective: "fast", source: "pending" },
      fastMode: {
        active: true,
        confirmedActive: false,
        source: "pending",
        confirmedSource: "active-thread",
        serviceTierRequestValue: "fast",
      },
    });
  });

  it("reports collaboration mode dirtiness and missing model blockers from the resolved runtime", () => {
    const blocked = runtimeSnapshot({
      pending: { collaborationMode: setCollaborationModeIntent("plan") },
      runtimeConfig: runtimeConfigFixture({}),
    });
    const ready = runtimeSnapshot({
      pending: {
        collaborationMode: setCollaborationModeIntent("plan"),
        model: setRuntimeIntentValue("gpt-5.5"),
      },
    });

    expect(resolveRuntimeControls(blocked, snapshotConfig(blocked)).collaborationMode).toMatchObject({
      pending: setCollaborationModeIntent("plan"),
      confirmed: "default",
      effective: "plan",
      dirty: true,
      blockedReason: "missing-model",
    });
    expect(resolveRuntimeControls(ready, snapshotConfig(ready)).collaborationMode).toMatchObject({
      pending: setCollaborationModeIntent("plan"),
      confirmed: "default",
      effective: "plan",
      dirty: true,
      blockedReason: null,
    });
  });

  it("resolves requested approval reviewer without adding it to turn runtime settings", () => {
    const snapshot = runtimeSnapshot({ pending: { approvalsReviewer: setRuntimeIntentValue("auto_review") } });
    const resolution = resolveRuntimeControls(snapshot, snapshotConfig(snapshot));

    expect(autoReviewActive(snapshot, snapshotConfig(snapshot))).toBe(true);
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

    expect(currentModel(snapshot, snapshotConfig(snapshot))).toBe("gpt-5-active");
    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).not.toHaveProperty("model");
    expect(pendingRuntimeSettingsPatch(snapshot, snapshotConfig(snapshot)).update).not.toHaveProperty("effort");
  });

  it("uses the explicit config when finding supported reasoning efforts", () => {
    const snapshot = runtimeSnapshot({
      pending: { model: resetRuntimeIntentToConfig() },
      runtimeConfig: runtimeConfigFixture({ model: "snapshot-model" }),
      availableModels: [
        { ...modelFixture("snapshot-model"), supportedReasoningEfforts: ["low"] },
        { ...modelFixture("explicit-model"), supportedReasoningEfforts: ["high"] },
      ],
    });
    const explicitConfig = runtimeConfigFixture({ model: "explicit-model" });

    expect(supportedReasoningEfforts(snapshot, explicitConfig)).toEqual(["high"]);
  });

  it("summarizes service tier and context meter state from one runtime snapshot", () => {
    const snapshot = runtimeSnapshot({ pending: { fastMode: setRuntimeIntentValue("enabled") }, activeThreadId: "thread" });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(contextSummary(snapshot)).toMatchObject({
      label: "Context 0%",
      title: "Context: 0 / 100,000 (0%). No turns in this thread yet.",
      percent: 0,
      level: "ok",
    });
    expect(
      contextSummary(
        runtimeSnapshot({
          activeThreadId: "thread",
          tokenUsage: {
            last: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 50, totalTokens: 1250 },
            total: { inputTokens: 2000, cachedInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 100, totalTokens: 2600 },
            modelContextWindow: 100_000,
          },
        }),
      ),
    ).toMatchObject({
      title: "Context: 1,000 / 100,000 (1%). Last request: 1,000 input, 200 output, 50 reasoning. Total: 2,600 tokens.",
    });
    expect(
      contextSummary(
        runtimeSnapshot({
          activeThreadId: "thread",
          hasThreadTurns: true,
        }),
      ),
    ).toMatchObject({
      label: "Context unknown",
      percent: null,
    });
  });

  it("serializes disabled Fast mode as a null service tier request", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
      pending: { fastMode: setRuntimeIntentValue("disabled") },
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBeNull();
  });

  it("serializes service tier reset for thread start as the configured tier instead of null", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({ service_tier: "fast" }),
      pending: { fastMode: resetRuntimeIntentToConfig() },
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("fast");
  });

  it("omits service tier reset for thread start when config has no service tier", () => {
    const snapshot = runtimeSnapshot({
      runtimeConfig: runtimeConfigFixture({}),
      pending: { fastMode: resetRuntimeIntentToConfig() },
    });

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBeNull();
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
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

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("fast");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(true);
    expect(resolveRuntimeControls(snapshot, snapshotConfig(snapshot)).fastMode).toMatchObject({
      active: true,
      effectiveServiceTier: "fast",
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

    expect(currentServiceTier(snapshot, snapshotConfig(snapshot))).toBe("flex");
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
    expect(serviceTierRequestForThreadStart(snapshot, snapshotConfig(snapshot))).toBe("flex");
  });

  it("summarizes Codex usage limits independently from context usage", () => {
    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 72.4, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        1_799_991_600_000,
      ),
    ).toMatchObject({
      rows: [{ label: "5h", value: "72%", resetLabel: "reset in 2h 20m", percent: 72, meterDivisions: 5 }],
      level: "warn",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: null,
            primary: { usedPercent: 95, windowDurationMins: null, resetsAt: null },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: "rate_limit_reached",
          },
        }),
        0,
      ),
    ).toMatchObject({
      rows: [{ percent: 95, resetLabel: null }],
      level: "danger",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: null },
            secondary: { usedPercent: 38, windowDurationMins: 10_080, resetsAt: null },
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        0,
      ),
    ).toMatchObject({
      rows: [
        { label: "5h", value: "15%", meterDivisions: 5 },
        { label: "1w", value: "38%", meterDivisions: 7 },
      ],
      level: "ok",
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_800_000_000 },
            secondary: null,
            individualLimit: null,
            rateLimitReachedType: null,
          },
        }),
        1_800_000_001_000,
      ),
    ).toMatchObject({
      rows: [{ resetLabel: "reset due" }],
    });

    expect(
      rateLimitSummary(
        runtimeSnapshot({
          rateLimit: {
            limitId: "codex",
            limitName: "Codex",
            primary: null,
            secondary: null,
            individualLimit: { limit: "$100", used: "$72", remainingPercent: 28, resetsAt: 1_800_000_000 },
            rateLimitReachedType: null,
          },
        }),
        1_799_991_600_000,
      ),
    ).toMatchObject({
      rows: [{ label: "monthly", value: "$72 / $100", resetLabel: "reset in 2h 20m", percent: 72, meterDivisions: null }],
      level: "warn",
    });
  });
});

interface RuntimeSnapshotPatch extends Partial<Omit<RuntimeSnapshot, "active" | "pending">> {
  active?: Partial<RuntimeSnapshot["active"]>;
  pending?: Partial<RuntimeSnapshot["pending"]>;
}

function runtimeSnapshot(overrides: RuntimeSnapshotPatch = {}): RuntimeSnapshot {
  const { active, pending, ...snapshotOverrides } = overrides;
  const snapshot: RuntimeSnapshot = {
    runtimeConfig: runtimeConfigFixture({
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      service_tier: "flex",
      model_context_window: 100_000,
    }),
    activeThreadId: null,
    active: {
      approvalPolicyKnown: false,
      sandboxPolicyKnown: false,
      permissionProfileKnown: false,
      serviceTierKnown: false,
      model: null,
      reasoningEffort: null,
      collaborationMode: null,
      serviceTier: null,
      approvalsReviewer: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
    },
    pending: {
      model: { kind: "unchanged" },
      reasoningEffort: { kind: "unchanged" },
      permissionProfile: { kind: "unchanged" },
      approvalPolicy: { kind: "unchanged" },
      approvalsReviewer: { kind: "unchanged" },
      collaborationMode: unchangedCollaborationModeIntent(),
      fastMode: { kind: "unchanged" },
    },
    tokenUsage: null,
    rateLimit: null,
    hasThreadTurns: false,
    availableModels: [],
  };
  return {
    ...snapshot,
    ...snapshotOverrides,
    active: {
      ...snapshot.active,
      ...(active && "serviceTier" in active ? { serviceTierKnown: true } : {}),
      ...active,
    },
    pending: {
      ...snapshot.pending,
      ...pending,
    },
  };
}

function snapshotConfig(snapshot: RuntimeSnapshot): RuntimeConfigSnapshot {
  return runtimeConfigOrDefault(snapshot.runtimeConfig);
}

function runtimeControls(snapshot: RuntimeSnapshot, config: RuntimeConfigSnapshot = snapshotConfig(snapshot)) {
  return resolveRuntimeControls(snapshot, config);
}

function currentModel(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string | null {
  return runtimeControls(snapshot, config).model.effective;
}

function currentReasoningEffort(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string | null {
  return runtimeControls(snapshot, config).reasoningEffort.effective;
}

function currentServiceTier(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string | null {
  return runtimeControls(snapshot, config).serviceTier.effective;
}

function autoReviewActive(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): boolean {
  return runtimeControls(snapshot, config).autoReview.active;
}

function fastModeActive(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): boolean {
  return runtimeControls(snapshot, config).fastMode.active;
}

function fastRuntimeServiceTierRequestValue(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): string {
  return runtimeControls(snapshot, config).fastMode.serviceTierRequestValue;
}

function supportedReasoningEfforts(snapshot: RuntimeSnapshot, config?: RuntimeConfigSnapshot): readonly string[] {
  return runtimeControls(snapshot, config).supportedReasoningEfforts;
}

function runtimeConfigFixture(config: Record<string, unknown>, layers: ConfigReadResult["layers"] = null): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers,
  });
}

function configLayer(config: Record<string, unknown>, profile: string | null): NonNullable<ConfigReadResult["layers"]>[number] {
  return {
    name: { type: "user", file: "/home/me/.codex/config.toml", profile },
    version: "1",
    config: config as NonNullable<ConfigReadResult["layers"]>[number]["config"],
    disabledReason: null,
  };
}

function modelFixture(model: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}
