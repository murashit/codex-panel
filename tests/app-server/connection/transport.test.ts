import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AppServerTransportHandlers, StdioAppServerTransport } from "../../../src/app-server/connection/transport";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("StdioAppServerTransport", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts once, forwards stdout lines, and reports its running state", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { handlers, instance } = transportInstance();

    instance.start();
    child.stdout.write("one line\n");

    expect(spawnMock).toHaveBeenCalledWith("codex", ["app-server"], {
      cwd: "/vault",
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: undefined,
    });
    expect(instance.isRunning()).toBe(true);
    expect(handlers.onLine).toHaveBeenCalledWith("one line");
    expect(() => instance.start()).toThrow("Codex app-server is already running.");
  });

  it("starts Windows executables directly", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const child = fakeChildProcess();
    const codexExe = String.raw`C:\Program Files\Codex\codex.exe`;
    spawnMock.mockReturnValue(child);

    transportInstance(codexExe).instance.start();

    expect(spawnMock).toHaveBeenCalledWith(codexExe, ["app-server"], {
      cwd: "/vault",
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: undefined,
    });
  });

  it.each(["darwin", "linux"] as const)("exposes an absolute %s executable's directory to its runtime dependencies", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("CODEX_PANEL_TEST_ENV", "preserved");
    const child = fakeChildProcess();
    const codexPath = "/opt/homebrew/bin/codex";
    spawnMock.mockReturnValue(child);

    transportInstance(codexPath).instance.start();

    expect(spawnMock).toHaveBeenCalledWith(codexPath, ["app-server"], {
      cwd: "/vault",
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: undefined,
      env: expect.objectContaining({
        CODEX_PANEL_TEST_ENV: "preserved",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      }),
    });
  });

  it("quotes Windows command shim paths that contain spaces", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.stubEnv("ComSpec", " ");
    vi.stubEnv("COMSPEC", " ");
    const child = fakeChildProcess();
    const codexBat = String.raw`C:\Program Files\nodejs\codex.bat`;
    spawnMock.mockReturnValue(child);

    transportInstance(codexBat).instance.start();

    expect(spawnMock).toHaveBeenCalledWith("cmd.exe", ["/d", "/s", "/c", `""${codexBat}" app-server"`], {
      cwd: "/vault",
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: true,
    });
  });

  it("serializes outbound messages and reports asynchronous write failures", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { handlers, instance } = transportInstance();
    instance.start();

    instance.send({ method: "initialized" });
    const [line, callback] = child.stdin.write.mock.calls[0] ?? [];
    expect(line).toBe('{"method":"initialized"}\n');

    const error = new Error("write failed");
    callback(error);
    expect(handlers.onError).toHaveBeenCalledWith(error);
  });

  it.each([
    ["before start", (child: FakeChildProcess) => void child],
    ["after kill", (child: FakeChildProcess) => Object.assign(child, { killed: true })],
    ["with destroyed stdin", (child: FakeChildProcess) => Object.assign(child.stdin, { destroyed: true })],
    ["with non-writable stdin", (child: FakeChildProcess) => Object.assign(child.stdin, { writable: false })],
  ])("rejects sends %s", (_label, arrange) => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { instance } = transportInstance();
    if (_label !== "before start") {
      instance.start();
      arrange(child);
    }

    expect(() => instance.send({ method: "initialized" })).toThrow("Codex app-server is not running.");
  });

  it("cleans up and reports process errors after flushing stderr", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { handlers, instance } = transportInstance();
    instance.start();
    child.stderr.write("partial log");

    const error = new Error("spawn failed");
    child.emit("error", error);

    expect(handlers.onLog).toHaveBeenCalledWith("partial log");
    expect(handlers.onError).toHaveBeenCalledWith(error);
    expect(instance.isRunning()).toBe(false);
  });

  it("cleans up and reports process exits after flushing stderr", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { handlers, instance } = transportInstance();
    instance.start();
    child.stderr.write("partial log");

    child.emit("exit", 7, "SIGTERM");

    expect(handlers.onLog).toHaveBeenCalledWith("partial log");
    expect(handlers.onExit).toHaveBeenCalledWith(7, "SIGTERM");
    expect(instance.isRunning()).toBe(false);
  });

  it("reports stdin stream errors", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { handlers, instance } = transportInstance();
    instance.start();

    const error = new Error("stdin failed");
    child.stdin.emit("error", error);

    expect(handlers.onError).toHaveBeenCalledWith(error);
  });

  it("stops a running process once and becomes safe to stop again", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { instance } = transportInstance();
    instance.start();

    instance.stop();
    instance.stop();

    expect(child.kill).toHaveBeenCalledOnce();
    expect(instance.isRunning()).toBe(false);
  });

  it("does not kill a process already marked as killed", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { instance } = transportInstance();
    instance.start();
    child.killed = true;

    instance.stop();

    expect(child.kill).not.toHaveBeenCalled();
    expect(instance.isRunning()).toBe(false);
  });

  it("emits complete stderr lines and flushes the final partial line", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { handlers, instance } = transportInstance();
    instance.start();

    child.stderr.write("first line\npartial");

    expect(handlers.onLog).toHaveBeenCalledWith("first line");
    expect(handlers.onLog).not.toHaveBeenCalledWith("partial");

    instance.stop();

    expect(handlers.onLog).toHaveBeenCalledWith("partial");
  });

  it("ignores whitespace-only stderr fragments when flushing", () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { handlers, instance } = transportInstance();
    instance.start();

    child.stderr.write("   ");
    child.emit("exit", 0, null);

    expect(handlers.onLog).not.toHaveBeenCalled();
  });
});

function transportInstance(codexPath = "codex") {
  const handlers: AppServerTransportHandlers = {
    onLine: vi.fn(),
    onLog: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
  };
  return {
    handlers,
    instance: new StdioAppServerTransport(codexPath, "/vault", handlers),
  };
}

type FakeChildProcess = ReturnType<typeof fakeChildProcess>;

function fakeChildProcess() {
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
    pid: 123,
  });
}
