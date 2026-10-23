import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

import type { RpcOutboundMessage } from "./rpc-messages";

interface AppServerSpawnSpec {
  command: string;
  args: string[];
  killProcessTreeOnStop: boolean;
  windowsVerbatimArguments?: boolean;
}

export interface AppServerTransport {
  start(): void;
  send(message: RpcOutboundMessage): void;
  stop(): void;
  isRunning(): boolean;
}

export interface AppServerTransportHandlers {
  onLine: (line: string) => void;
  onLog: (message: string) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError: (error: Error) => void;
}

function createAppServerSpawnSpec(codexPath: string, options: { platform?: NodeJS.Platform; comSpec?: string } = {}): AppServerSpawnSpec {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || !isWindowsCommandScript(codexPath)) {
    return { command: codexPath, args: ["app-server"], killProcessTreeOnStop: false };
  }

  const comSpec = options.comSpec?.trim() || process.env["ComSpec"]?.trim() || process.env["COMSPEC"]?.trim() || "cmd.exe";
  return {
    command: comSpec,
    args: ["/d", "/s", "/c", `"${quoteWindowsCmdArgument(codexPath)} app-server"`],
    killProcessTreeOnStop: true,
    windowsVerbatimArguments: true,
  };
}

function isWindowsCommandScript(path: string): boolean {
  return /\.(?:bat|cmd)$/i.test(path);
}

function quoteWindowsCmdArgument(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function createAppServerEnvironment(codexPath: string): NodeJS.ProcessEnv | undefined {
  if (process.platform === "win32" || !path.isAbsolute(codexPath)) return undefined;

  const executableDirectory = path.dirname(codexPath);
  const inheritedPath = process.env["PATH"];
  return {
    ...process.env,
    PATH: inheritedPath ? `${executableDirectory}${path.delimiter}${inheritedPath}` : executableDirectory,
  };
}

export class StdioAppServerTransport implements AppServerTransport {
  private running: {
    process: ChildProcessWithoutNullStreams;
    reader: readline.Interface;
    killProcessTreeOnStop: boolean;
  } | null = null;
  private stderrBuffer = "";

  constructor(
    private readonly codexPath: string,
    private readonly cwd: string,
    private readonly handlers: AppServerTransportHandlers,
    private readonly spawnProcess: typeof spawn = spawn,
  ) {}

  start(): void {
    if (this.running) {
      throw new Error("Codex app-server is already running.");
    }

    const launch = createAppServerSpawnSpec(this.codexPath);
    const environment = createAppServerEnvironment(this.codexPath);
    const child = this.spawnProcess(launch.command, launch.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      ...(environment ? { env: environment } : {}),
    });

    child.once("error", (error) => {
      this.releaseProcess();
      this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    child.once("exit", (code, signal) => {
      this.releaseProcess();
      this.handlers.onExit(code, signal);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      this.handleStderr(chunk.toString("utf8"));
    });
    child.stdin.on("error", (error) => {
      this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    const reader = readline.createInterface({ input: child.stdout });
    this.running = { process: child, reader, killProcessTreeOnStop: launch.killProcessTreeOnStop };
    reader.on("line", (line) => {
      this.handlers.onLine(line);
    });
  }

  send(message: RpcOutboundMessage): void {
    const child = this.running?.process;
    if (!child || child.killed || child.stdin.destroyed || !child.stdin.writable) {
      throw new Error("Codex app-server is not running.");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  stop(): void {
    const running = this.releaseProcess();
    const child = running?.process;
    if (child && !child.killed) {
      if (running.killProcessTreeOnStop && typeof child.pid === "number") {
        killWindowsProcessTree(child.pid, this.spawnProcess);
      } else {
        child.kill();
      }
    }
  }

  isRunning(): boolean {
    return this.running !== null && !this.running.process.killed;
  }

  private releaseProcess(): typeof this.running {
    this.flushStderr();
    const running = this.running;
    running?.reader.close();
    this.running = null;
    return running;
  }

  private handleStderr(text: string): void {
    this.stderrBuffer += text;
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) this.handlers.onLog(trimmed);
    }
  }

  private flushStderr(): void {
    const trimmed = this.stderrBuffer.trim();
    this.stderrBuffer = "";
    if (trimmed.length > 0) this.handlers.onLog(trimmed);
  }
}

function killWindowsProcessTree(pid: number, spawnProcess: typeof spawn): void {
  const killer = spawnProcess("taskkill", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true,
  });
  killer.on("error", () => undefined);
}
