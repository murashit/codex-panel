import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const vault = "/tmp/Vault";
const profile = "/tmp/profile";
const plugins = `${vault}/.obsidian`;
await mkdir(process.env.HOME, { recursive: true });
await mkdir(process.env.XDG_RUNTIME_DIR, { mode: 0o700 });
await mkdir(profile);
await mkdir(plugins, { recursive: true });
await cp("/opt/panel", `${plugins}/plugins/codex-panel`, { recursive: true });
await writeFile(`${plugins}/community-plugins.json`, JSON.stringify(["codex-panel"]));
await writeFile(
  `${profile}/obsidian.json`,
  JSON.stringify({ vaults: { "123456789abcdeff": { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }),
);
const app = spawn(
  "/opt/obsidian/obsidian",
  [
    "--no-sandbox",
    "--disable-gpu",
    "--ozone-platform=x11",
    "--enable-logging=stderr",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
  ],
  { stdio: "inherit" },
);
async function until(description, check) {
  for (let i = 0; i < 150; i++) {
    if (app.exitCode !== null || app.signalCode) throw Error(`Obsidian exited: ${app.exitCode ?? app.signalCode}`);
    const result = await check();
    if (result) return result;
    await delay(200);
  }
  throw Error(`Timed out waiting for ${description}`);
}
let socket;
try {
  const port = await until("debug port", async () => {
    try {
      return (await readFile(`${profile}/DevToolsActivePort`, "utf8")).split("\n")[0];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  });
  const page = await until("vault window", async () =>
    (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
      (t) => t.type === "page" && t.url.startsWith("app://obsidian.md/"),
    ),
  );
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  async function call(method, params) {
    const id = ++sequence;
    const reply = new Promise((resolve, reject) => {
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id === id) {
          if (message.error) reject(Error(message.error.message));
          else resolve(message.result);
        }
      };
    });
    socket.send(JSON.stringify({ id, method, params }));
    return reply;
  }
  async function evaluate(expression) {
    const reply = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  }
  try {
    await until("workspace", () => evaluate("window.app?.workspace?.layoutReady"));
    assert.equal(await evaluate("app.vault.adapter.getBasePath()"), vault);
    await until("Codex Panel plugin", () =>
      evaluate(`(() => {
      if(app.plugins.plugins["codex-panel"])return true;
      [...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Trust author and enable plugins")?.click();
      return false;
    })()`),
    );
    assert.equal(await evaluate("app.commands.executeCommandById('codex-panel:open-panel')"), true);
    let clicked = false;
    await until("connected status", async () => {
      await evaluate("document.querySelector('[aria-label=\"Show status\"]')?.click()");
      if (await evaluate("[...document.querySelectorAll('.codex-panel__status-panel-item')].some(el=>el.textContent.trim()==='Reconnect')"))
        return true;
      if (!clicked)
        clicked = await evaluate(
          "(()=>{const el=[...document.querySelectorAll('.codex-panel__status-panel-item')].find(el=>el.textContent.trim()==='Connect');el?.click();return !!el})()",
        );
      return false;
    });
    console.log("Codex Panel connected in the test vault.");
  } catch (error) {
    const screenshot = await call("Page.captureScreenshot", {});
    await writeFile("/tmp/obsidian.png", Buffer.from(screenshot.data, "base64"));
    throw error;
  }
} finally {
  socket?.close();
  app.kill();
}
