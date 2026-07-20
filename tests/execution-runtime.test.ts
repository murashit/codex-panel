import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexExecutionRuntime } from "../src/execution-runtime";
import type { ThreadPickerController } from "../src/features/thread-picker/modal.obsidian";
import { DEFAULT_SETTINGS } from "../src/settings/model";

const { openThreadPickerMock } = vi.hoisted(() => ({
  openThreadPickerMock: vi.fn(),
}));

vi.mock("../src/features/thread-picker/modal.obsidian", () => ({
  openThreadPicker: openThreadPickerMock,
}));

describe("CodexExecutionRuntime thread picker ownership", () => {
  beforeEach(() => {
    openThreadPickerMock.mockReset();
  });

  it("replaces the active picker and disposes only the current picker", () => {
    const pickers = pickerFactory();
    const runtime = executionRuntime();

    runtime.openThreadPicker();
    runtime.openThreadPicker();

    expect(pickers.controllers[0]?.close).toHaveBeenCalledOnce();
    expect(pickers.controllers[1]?.close).not.toHaveBeenCalled();

    runtime.dispose();

    expect(pickers.controllers[0]?.close).toHaveBeenCalledOnce();
    expect(pickers.controllers[1]?.close).toHaveBeenCalledOnce();
  });

  it("releases a naturally closed picker before runtime disposal", () => {
    const pickers = pickerFactory();
    const runtime = executionRuntime();

    runtime.openThreadPicker();
    pickers.finish[0]?.();
    runtime.dispose();

    expect(pickers.controllers[0]?.close).not.toHaveBeenCalled();
  });
});

function pickerFactory(): {
  controllers: Array<ThreadPickerController & { close: ReturnType<typeof vi.fn> }>;
  finish: Array<() => void>;
} {
  const controllers: Array<ThreadPickerController & { close: ReturnType<typeof vi.fn> }> = [];
  const finish: Array<() => void> = [];
  openThreadPickerMock.mockImplementation((_host: unknown, onClosed: () => void) => {
    const controller = {
      close: vi.fn(() => {
        onClosed();
      }),
    };
    controllers.push(controller);
    finish.push(onClosed);
    return controller;
  });
  return { controllers, finish };
}

function executionRuntime(): CodexExecutionRuntime {
  return new CodexExecutionRuntime({
    app: {} as never,
    context: { codexPath: "codex", vaultPath: "/vault" },
    settings: () => ({ ...DEFAULT_SETTINGS }),
    workspace: {} as never,
    onThreadCatalogEvent: vi.fn(),
    openNewPanel: vi.fn(),
    openThreadInCurrentView: vi.fn(),
    openThreadInAvailableView: vi.fn(),
    openPanelActivities: () => [],
  });
}
