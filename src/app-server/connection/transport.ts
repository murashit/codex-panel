import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
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

export class StdioAppServerTransport implements AppServerTransport {
  private process: ChildProcessWithoutNullStreams | null = null;
  private reader: readline.Interface | null = null;
  private stderrBuffer = "";
  private killProcessTreeOnStop = false;

  constructor(
    private readonly codexPath: string,
    private readonly cwd: string,
    private readonly handlers: AppServerTransportHandlers,
  ) {}

  start(): void {
    if (this.process) {
      throw new Error("Codex app-server is already running.");
    }

    const launch = createAppServerSpawnSpec(this.codexPath);
    this.killProcessTreeOnStop = launch.killProcessTreeOnStop;
    this.process = spawn(launch.command, launch.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });

    this.process.once("error", (error) => {
      this.flushStderr();
      this.reader?.close();
      this.reader = null;
      this.process = null;
      this.killProcessTreeOnStop = false;
      this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    this.process.once("exit", (code, signal) => {
      this.flushStderr();
      this.reader?.close();
      this.reader = null;
      this.process = null;
      this.killProcessTreeOnStop = false;
      this.handlers.onExit(code, signal);
    });

    this.process.stderr.on("data", (chunk: Buffer) => {
      this.handleStderr(chunk.toString("utf8"));
    });
    this.process.stdin.on("error", (error) => {
      this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on("line", (line) => {
      this.handlers.onLine(line);
    });
  }

  send(message: RpcOutboundMessage): void {
    if (!this.process || this.process.killed || this.process.stdin.destroyed || !this.process.stdin.writable) {
      throw new Error("Codex app-server is not running.");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  stop(): void {
    this.flushStderr();
    this.reader?.close();
    this.reader = null;
    const child = this.process;
    if (child && !child.killed) {
      if (this.killProcessTreeOnStop && typeof child.pid === "number") {
        killWindowsProcessTree(child.pid);
      } else {
        child.kill();
      }
    }
    this.process = null;
    this.killProcessTreeOnStop = false;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
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

function killWindowsProcessTree(pid: number): void {
  const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true,
  });
  killer.on("error", () => undefined);
}
