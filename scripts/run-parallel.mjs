import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";

const scripts = process.argv.slice(2);

if (scripts.length === 0) {
  console.error("Usage: node scripts/run-parallel.mjs <npm-script> [<npm-script> ...]");
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const longestNameLength = Math.max(...scripts.map((script) => script.length));
const running = new Set();

function prefixedOutput(script, text) {
  const prefix = `[${script.padEnd(longestNameLength)}] `;
  return text
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function runScript(script) {
  const startedAt = process.hrtime.bigint();
  console.log(`[${script.padEnd(longestNameLength)}] started`);

  const child = spawn(npmCommand, ["run", "--silent", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  running.add(child);
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));

  return new Promise((resolve) => {
    child.on("error", (error) => {
      running.delete(child);
      console.error(`[${script.padEnd(longestNameLength)}] failed to start: ${error.message}`);
      resolve({ script, status: 1, output: "" });
    });

    child.on("close", (code, signal) => {
      running.delete(child);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const elapsedSeconds = (elapsedMs / 1000).toFixed(1);

      if (code === 0) {
        console.log(`[${script.padEnd(longestNameLength)}] passed in ${elapsedSeconds}s`);
        resolve({ script, status: 0, output: Buffer.concat(output).toString() });
      } else {
        const detail = signal ? `signal ${signal}` : `exit ${code ?? 1}`;
        console.error(`[${script.padEnd(longestNameLength)}] failed with ${detail} after ${elapsedSeconds}s`);
        resolve({ script, status: code ?? 1, output: Buffer.concat(output).toString() });
      }
    });
  });
}

function stopRunning(signal) {
  for (const child of running) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => {
  stopRunning("SIGINT");
});

process.on("SIGTERM", () => {
  stopRunning("SIGTERM");
});

const results = await Promise.all(scripts.map(runScript));
const failed = results.filter((result) => result.status !== 0);

if (failed.length > 0) {
  for (const result of failed) {
    if (!result.output.trim()) continue;
    console.error(`\nOutput from ${result.script}:`);
    console.error(prefixedOutput(result.script, result.output));
  }

  console.error(`Failed checks: ${failed.map((result) => result.script).join(", ")}`);
  process.exit(1);
}

console.log(`All checks passed: ${scripts.join(", ")}`);
