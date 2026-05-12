import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as readline from "readline";

import type { RpcOutboundMessage } from "./types";

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

export class StdioAppServerTransport implements AppServerTransport {
  private process: ChildProcessWithoutNullStreams | null = null;
  private reader: readline.Interface | null = null;
  private stderrBuffer = "";

  constructor(
    private readonly codexPath: string,
    private readonly cwd: string,
    private readonly handlers: AppServerTransportHandlers,
  ) {}

  start(): void {
    if (this.process) {
      throw new Error("Codex app-server is already running.");
    }

    this.process = spawn(this.codexPath, ["app-server"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.once("error", (error) => {
      this.reader?.close();
      this.reader = null;
      this.process = null;
      this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    this.process.once("exit", (code, signal) => {
      this.reader?.close();
      this.reader = null;
      this.process = null;
      this.handlers.onExit(code, signal);
    });

    this.process.stderr.on("data", (chunk: Buffer) => {
      this.handleStderr(chunk.toString("utf8"));
    });
    this.process.stdin.on("error", (error) => {
      this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    });

    this.reader = readline.createInterface({ input: this.process.stdout });
    this.reader.on("line", (line) => this.handlers.onLine(line));
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
    this.reader?.close();
    this.reader = null;
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
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
}
