import { describe, expect, it, vi } from "vitest";

import {
  type AppServerTransportHandlers,
  createAppServerSpawnSpec,
  StdioAppServerTransport,
} from "../../src/app-server/connection/transport";

interface TestableTransport {
  handleStderr(text: string): void;
  flushStderr(): void;
}

describe("createAppServerSpawnSpec", () => {
  it("starts regular commands directly", () => {
    expect(createAppServerSpawnSpec("codex", { platform: "darwin" })).toEqual({
      command: "codex",
      args: ["app-server"],
      killProcessTreeOnStop: false,
    });
  });

  it("starts Windows executables directly", () => {
    const codexExe = String.raw`C:\Program Files\Codex\codex.exe`;

    expect(createAppServerSpawnSpec(codexExe, { platform: "win32" })).toEqual({
      command: codexExe,
      args: ["app-server"],
      killProcessTreeOnStop: false,
    });
  });

  it("quotes Windows command shim paths that contain spaces", () => {
    const codexBat = String.raw`C:\Program Files\nodejs\codex.bat`;

    expect(createAppServerSpawnSpec(codexBat, { platform: "win32", comSpec: " " })).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `""${codexBat}" app-server"`],
      killProcessTreeOnStop: true,
      windowsVerbatimArguments: true,
    });
  });
});

describe("StdioAppServerTransport", () => {
  it("emits complete stderr lines and flushes the final partial line", () => {
    const { onLog, transport } = transportFixture();

    transport.handleStderr("first line\npartial");

    expect(onLog).toHaveBeenCalledWith("first line");
    expect(onLog).not.toHaveBeenCalledWith("partial");

    transport.flushStderr();

    expect(onLog).toHaveBeenCalledWith("partial");
  });

  it("ignores whitespace-only stderr fragments when flushing", () => {
    const { onLog, transport } = transportFixture();

    transport.handleStderr("   ");
    transport.flushStderr();

    expect(onLog).not.toHaveBeenCalled();
  });
});

function transportFixture(): { onLog: ReturnType<typeof vi.fn>; transport: TestableTransport } {
  const onLog = vi.fn();
  const handlers: AppServerTransportHandlers = {
    onLine: vi.fn(),
    onLog,
    onExit: vi.fn(),
    onError: vi.fn(),
  };
  return {
    onLog,
    transport: new StdioAppServerTransport("codex", "/vault", handlers) as unknown as TestableTransport,
  };
}
