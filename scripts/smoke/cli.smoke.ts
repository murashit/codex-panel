import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { expect, it } from "vitest";
import compatibility from "../../src/app-server/compatibility.json";
import { AppServerClient } from "../../src/app-server/connection/client";
import { codexPanelAppServerInitializeParams } from "../../src/app-server/connection/client-profile";

const windows = process.platform === "win32";
it.each(windows ? ["exe", "cmd", "bat"] : ["native"])("lists threads and stops the %s launch", async (kind) => {
  const source = process.env["PANEL_CODEX_BINARY"];
  if (!source) throw new Error("Set PANEL_CODEX_BINARY to the supported native Codex executable.");
  const directory = realpathSync.native(await mkdtemp(join(tmpdir(), "Panel smoke ")));
  const binary = join(directory, basename(source));
  const command = kind === "cmd" || kind === "bat" ? join(directory, `launch.${kind}`) : binary;
  const previousHome = process.env["CODEX_HOME"];
  let client: AppServerClient | undefined;
  try {
    process.env["CODEX_HOME"] = join(directory, "profile");
    await mkdir(process.env["CODEX_HOME"]);
    await copyFile(resolve(source), binary);
    expect(execFileSync(binary, ["--version"], { encoding: "utf8" }).trim()).toBe(
      `codex-cli ${compatibility.codexAppServer.testedCliVersion}`,
    );
    if (command !== binary) await writeFile(command, `@echo off\r\n"%~dp0${basename(binary)}" %*\r\n`);
    client = new AppServerClient({
      codexPath: command,
      cwd: directory,
      initializeParams: codexPanelAppServerInitializeParams(),
      handlers: { onNotification() {}, onExit() {}, onLog() {}, onServerRequest() {} },
      requestTimeoutMs: 8000,
    });
    await client.connect();
    expect((await client.request("thread/list", { limit: 1 })).data).toEqual([]);
    expect(findServers(binary)).toHaveLength(1);
    client.disconnect();
    await expect.poll(() => findServers(binary), { timeout: 8000 }).toEqual([]);
  } finally {
    client?.disconnect();
    if (previousHome === undefined) delete process.env["CODEX_HOME"];
    else process.env["CODEX_HOME"] = previousHome;
    for (const pid of findServers(binary)) process.kill(pid, "SIGKILL");
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

function findServers(binary: string): number[] {
  if (windows) {
    const ids = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object ExecutablePath -eq $env:PANEL_SMOKE_EXE | Select-Object -ExpandProperty ProcessId",
      ],
      { encoding: "utf8", env: { ...process.env, PANEL_SMOKE_EXE: binary } },
    ).trim();
    return ids ? ids.split(/\s+/).map(Number) : [];
  }
  return execFileSync("ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      return match?.[2] === `${binary} app-server` ? [Number(match[1])] : [];
    });
}
