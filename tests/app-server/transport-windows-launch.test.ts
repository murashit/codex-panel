import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("StdioAppServerTransport Windows launch", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.resetModules();
    spawnMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("starts Windows command shims through cmd.exe", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.stubEnv("ComSpec", String.raw`C:\Windows\System32\cmd.exe`);
    const { StdioAppServerTransport } = await import("../../src/app-server/connection/transport");
    const codexCmd = String.raw`C:\Users\me\AppData\Roaming\npm\codex.cmd`;
    const cwd = String.raw`C:\vault`;

    spawnMock.mockReturnValue(fakeChildProcess());

    new StdioAppServerTransport(codexCmd, cwd, {
      onLine: vi.fn(),
      onLog: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    }).start();

    expect(spawnMock).toHaveBeenCalledWith(String.raw`C:\Windows\System32\cmd.exe`, ["/d", "/c", `"${codexCmd}" app-server`], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("kills the cmd.exe process tree when stopping Windows command shim launches", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.stubEnv("ComSpec", String.raw`C:\Windows\System32\cmd.exe`);
    const { StdioAppServerTransport } = await import("../../src/app-server/connection/transport");
    const codexCmd = String.raw`C:\Users\me\AppData\Roaming\npm\codex.cmd`;
    const cmdProcess = fakeChildProcess({ pid: 4242 });

    spawnMock.mockReturnValue(cmdProcess);

    const transport = new StdioAppServerTransport(codexCmd, String.raw`C:\vault`, {
      onLine: vi.fn(),
      onLog: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    });
    transport.start();
    transport.stop();

    expect(cmdProcess.kill).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenLastCalledWith("taskkill", ["/pid", "4242", "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  });
});

function fakeChildProcess(options: { pid?: number } = {}) {
  const stdin = Object.assign(new EventEmitter(), {
    destroyed: false,
    writable: true,
    write: vi.fn(),
  });
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin,
    killed: false,
    kill: vi.fn(),
    pid: options.pid,
  });
}
