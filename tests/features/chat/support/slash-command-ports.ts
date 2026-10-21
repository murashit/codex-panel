import { vi } from "vitest";
import type { SlashCommandExecutionContext } from "../../../../src/features/chat/application/slash-commands/execution-contracts";

export function slashSubmissionFixture(): SlashCommandExecutionContext["submission"] {
  return { isCurrent: vi.fn(() => true), markAdopted: vi.fn(), adoptPanelTarget: vi.fn() };
}

export function slashRuntimeSettingsFixture(): SlashCommandExecutionContext["runtimeSettings"] {
  return {
    toggleFastMode: vi.fn(),
    toggleCollaborationMode: vi.fn(),
    toggleAutoReview: vi.fn(),
    requestModel: vi.fn(),
    resetModelToConfig: vi.fn(),
    requestPermissionProfile: vi.fn(),
    resetPermissionProfileToConfig: vi.fn(),
    requestReasoningEffort: vi.fn(),
    resetReasoningEffortToConfig: vi.fn(),
  };
}

export function slashThreadCommandsFixture(): SlashCommandExecutionContext["threadCommands"] {
  return {
    forkThread: vi.fn().mockResolvedValue(undefined),
    rollbackThread: vi.fn().mockResolvedValue(undefined),
    compactThread: vi.fn().mockResolvedValue(undefined),
    archiveThread: vi.fn().mockResolvedValue(undefined),
    renameThread: vi.fn().mockResolvedValue(true),
  };
}

export function slashGoalsFixture(): SlashCommandExecutionContext["goals"] {
  return {
    activeGoal: vi.fn(() => null),
    setObjective: vi.fn().mockResolvedValue(true),
    setStatus: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(true),
  };
}
