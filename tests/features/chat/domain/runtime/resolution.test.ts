import { describe, expect, it } from "vitest";
import {
  resetRuntimeIntentToConfig,
  setCollaborationModeIntent,
  setRuntimeIntentValue,
} from "../../../../../src/features/chat/domain/runtime/intent";
import { resolveRuntimeControls } from "../../../../../src/features/chat/domain/runtime/resolution";
import { serviceTierRequestForThreadStart } from "../../../../../src/features/chat/domain/runtime/thread-settings-patch";
import {
  autoReviewActive,
  configLayer,
  currentModel,
  currentReasoningEffort,
  currentServiceTier,
  fastModeActive,
  fastRuntimeServiceTierRequestValue,
  modelFixture,
  modelPendingIntentCases,
  runtimeConfigFixture,
  runtimeLayerCase,
  runtimeSnapshot,
  snapshotConfig,
  supportedReasoningEfforts,
} from "./support";

describe("runtime control resolution", () => {
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

  it("marks the sandbox policy pending and unknown when selecting a different permission profile", () => {
    const runtimeConfig = runtimeConfigFixture({});
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      runtimeConfig: {
        ...runtimeConfig,
        startupPermissions: {
          approvalPolicy: "on-request",
          activePermissionProfile: { id: ":startup", extends: null },
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: ["/vault"],
            networkAccess: true,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: false,
          },
        },
      },
      active: {
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        activePermissionProfile: { id: ":read-only", extends: null },
      },
      pending: { permissionProfile: setRuntimeIntentValue(":workspace") },
    });

    expect(resolveRuntimeControls(snapshot, snapshotConfig(snapshot))).toMatchObject({
      permissionProfile: { effective: ":workspace", source: "pending" },
      sandboxPolicy: {
        confirmed: { type: "readOnly", networkAccess: false },
        confirmedSource: "active-thread",
        effective: null,
        source: "pending",
      },
    });
  });

  it("uses the configured sandbox policy when reselecting the startup permission profile", () => {
    const configuredPolicy = {
      type: "workspaceWrite" as const,
      writableRoots: ["/vault"],
      networkAccess: true,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: false,
    };
    const runtimeConfig = runtimeConfigFixture({});
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      runtimeConfig: {
        ...runtimeConfig,
        startupPermissions: {
          approvalPolicy: "on-request",
          activePermissionProfile: { id: ":workspace", extends: null },
          sandboxPolicy: configuredPolicy,
        },
      },
      active: {
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        activePermissionProfile: { id: ":read-only", extends: null },
      },
      pending: { permissionProfile: setRuntimeIntentValue(":workspace") },
    });
    const config = snapshotConfig(snapshot);
    const resolution = resolveRuntimeControls(snapshot, config);

    expect(resolution.sandboxPolicy).toMatchObject({
      confirmed: { type: "readOnly", networkAccess: false },
      confirmedSource: "active-thread",
      effective: configuredPolicy,
      source: "pending",
    });
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
    const activeGuardian = runtimeSnapshot({
      active: { approvalsReviewer: "guardian_subagent" },
    });

    expect(autoReviewActive(requested, snapshotConfig(requested))).toBe(false);
    expect(autoReviewActive(active, snapshotConfig(active))).toBe(false);
    expect(autoReviewActive(configured, snapshotConfig(configured))).toBe(true);
    expect(autoReviewActive(activeGuardian, snapshotConfig(activeGuardian))).toBe(true);
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
    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(false);
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
      availableModels: [{ ...modelFixture("gpt-pending"), serviceTiers: [{ id: "priority", name: "Fast" }] }],
      pending: {
        ...active.pending,
        model: setRuntimeIntentValue("gpt-pending"),
        reasoningEffort: setRuntimeIntentValue("low"),
        permissionProfile: setRuntimeIntentValue(":workspace"),
        approvalPolicy: setRuntimeIntentValue("on-request"),
        approvalsReviewer: setRuntimeIntentValue("guardian_subagent"),
        fastMode: setRuntimeIntentValue("enabled"),
      },
    });

    expect(resolveRuntimeControls(configured, snapshotConfig(configured))).toMatchObject({
      model: { effective: "gpt-config", source: "config" },
      reasoningEffort: { effective: "medium", source: "config" },
      permissionProfile: { effective: ":workspace", source: "config" },
      sandboxPolicy: { effective: null, source: "none" },
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
      approvalPolicy: { confirmed: "never", confirmedSource: "active-thread", effective: "on-request", source: "pending" },
      approvalsReviewer: { confirmed: "user", confirmedSource: "active-thread", effective: "guardian_subagent", source: "pending" },
      serviceTier: { confirmed: "flex", confirmedSource: "active-thread", effective: "priority", source: "pending" },
      fastMode: {
        active: true,
        confirmedActive: false,
        source: "pending",
        confirmedSource: "active-thread",
        serviceTierRequestValue: "priority",
      },
    });
  });

  it("model-checks runtime value precedence for configured, active, and pending model layers", () => {
    for (const configured of [null, "gpt-config"] as const) {
      for (const active of [null, "gpt-active"] as const) {
        for (const pending of modelPendingIntentCases()) {
          const snapshot = runtimeSnapshot({
            runtimeConfig: runtimeConfigFixture(configured ? { model: configured } : {}),
            active: { model: active },
            pending: { model: pending.intent },
          });
          const model = resolveRuntimeControls(snapshot, snapshotConfig(snapshot)).model;
          const expectedConfirmed = active ?? configured;
          const expectedConfirmedSource = active ? "active-thread" : configured ? "config" : "none";

          expect(model, runtimeLayerCase(configured, active, pending.name)).toMatchObject({
            configured,
            active,
            pending: pending.intent,
            confirmed: expectedConfirmed,
            confirmedSource: expectedConfirmedSource,
            effective: pending.name === "set" ? "gpt-pending" : pending.name === "resetToConfig" ? configured : expectedConfirmed,
            source: pending.name === "set" ? "pending" : pending.name === "resetToConfig" ? "config" : expectedConfirmedSource,
          });
        }
      }
    }
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

  it.each([
    { name: "catalog Fast tier", serviceTier: "catalog-fast", serviceTiers: [{ id: "catalog-fast", name: "Fast" }], expected: true },
    { name: "catalog Priority tier", serviceTier: "priority", serviceTiers: [{ id: "priority", name: "Priority" }], expected: false },
    { name: "catalog Flex tier", serviceTier: "flex", serviceTiers: [{ id: "flex", name: "Flex" }], expected: false },
  ])("classifies received $name from catalog metadata", ({ serviceTier, serviceTiers, expected }) => {
    const snapshot = runtimeSnapshot({
      activeThreadId: "thread",
      active: { model: "gpt-5.5", serviceTier },
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [{ ...modelFixture("gpt-5.5"), serviceTiers }],
    });

    expect(fastModeActive(snapshot, snapshotConfig(snapshot))).toBe(expected);
  });
});
