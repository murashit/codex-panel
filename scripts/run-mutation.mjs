import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const reportDirectory = "reports/mutation";
const statuses = ["Killed", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Timeout", "Ignored", "Pending"];
const command = [
  process.execPath,
  "node_modules/@stryker-mutator/core/bin/stryker.js",
  "run",
  "--force",
  "--concurrency",
  "2",
  "--reporters",
  "clear-text,progress-append-only,json,html",
];

function writeMetadata(cwd, metadata) {
  mkdirSync(resolve(cwd, reportDirectory), { recursive: true });
  writeFileSync(resolve(cwd, reportDirectory, "run.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

function initialMetadata(cwd) {
  const hashes = {};
  for (const file of [
    "package-lock.json",
    "stryker.config.mjs",
    "vitest.config.mts",
    "scripts/stryker-vitest5-runner.mjs",
    "scripts/run-mutation.mjs",
  ]) {
    hashes[file] = existsSync(resolve(cwd, file))
      ? createHash("sha256")
          .update(readFileSync(resolve(cwd, file)))
          .digest("hex")
      : null;
  }
  const versions = { node: process.version };
  for (const name of ["@stryker-mutator/core", "@stryker-mutator/vitest-runner", "vitest"]) {
    const file = resolve(cwd, "node_modules", name, "package.json");
    versions[name] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : null;
  }
  return {
    schemaVersion: 1,
    commit: process.env.GITHUB_SHA ?? null,
    source: process.env.GITHUB_SHA ? "github-checkout" : "local-working-copy",
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    versions,
    hashes,
    reuse: false,
    status: "not_started",
    completed: false,
    counts: null,
  };
}

function countReport(cwd) {
  const report = JSON.parse(readFileSync(resolve(cwd, reportDirectory, "mutation.json"), "utf8"));
  if (report.schemaVersion !== "1.0" || !report.files || typeof report.files !== "object" || Array.isArray(report.files)) {
    throw new Error("Missing or unsupported mutation report structure");
  }
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const file of Object.values(report.files)) {
    if (!Array.isArray(file.mutants)) throw new Error("Missing mutants in report file");
    for (const mutant of file.mutants) {
      if (!statuses.includes(mutant.status)) throw new Error(`Unknown mutant status: ${mutant.status}`);
      counts[mutant.status]++;
    }
  }
  if (Object.values(counts).every((count) => count === 0)) throw new Error("Report contains no mutants");
  return counts;
}

// GNU timeout owns the entire child process group, including Stryker workers.
// Keep its deadline below the Actions step/job limits so finalization can run.
export async function runMutation({ cwd = process.cwd(), invocation = command, timeoutSeconds = 7200 } = {}) {
  rmSync(resolve(cwd, reportDirectory), { recursive: true, force: true });
  const metadata = initialMetadata(cwd);
  const started = Date.now();
  Object.assign(metadata, { status: "running", startedAt: new Date(started).toISOString(), command: invocation, timeoutSeconds });
  writeMetadata(cwd, metadata);
  const log = openSync(resolve(cwd, reportDirectory, "mutation.log"), "w");
  console.log(`Full mutation run: ${invocation.join(" ")} (deadline ${timeoutSeconds}s; log: ${reportDirectory}/mutation.log)`);
  try {
    const result = await new Promise((resolveResult, reject) => {
      const child = spawn("timeout", ["--kill-after=10s", `${timeoutSeconds}s`, ...invocation], { cwd, stdio: ["ignore", "pipe", "pipe"] });
      for (const output of [child.stdout, child.stderr]) {
        output.on("data", (chunk) => {
          writeSync(log, chunk);
          process.stdout.write(chunk);
        });
      }
      child.once("error", reject);
      child.once("close", (code, signal) => resolveResult({ code, signal }));
    });
    metadata.exitCode = result.code;
    metadata.signal = result.signal;
    metadata.status = result.code === 124 ? "timed_out" : "failed";
    // Keep partial counts useful, but never treat a nonzero exit as completion.
    metadata.counts = countReport(cwd);
    if (result.code === 0 && metadata.counts.Pending === 0) {
      metadata.status = "completed";
      metadata.completed = true;
    } else {
      metadata.error = `Mutation execution did not complete: exit=${result.code}, signal=${result.signal}, pending=${metadata.counts.Pending}`;
    }
  } catch (error) {
    if (metadata.status === "running") metadata.status = "failed";
    metadata.error = String(error);
  } finally {
    closeSync(log);
    metadata.finishedAt = new Date().toISOString();
    metadata.durationSeconds = (Date.now() - started) / 1000;
    writeMetadata(cwd, metadata);
  }
  console.log(`Mutation run ${metadata.status}; metadata: ${reportDirectory}/run.json`);
  return metadata.completed ? 0 : 1;
}

// Also runs after dependency installation failure or interrupted execution.
export function finalizeMutation(cwd = process.cwd()) {
  const file = resolve(cwd, reportDirectory, "run.json");
  const metadata = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : initialMetadata(cwd);
  if (!metadata.finishedAt) {
    metadata.status = metadata.status === "running" ? "interrupted" : "not_started";
    metadata.completed = false;
    metadata.finishedAt = new Date().toISOString();
    metadata.durationSeconds = metadata.startedAt ? (Date.now() - Date.parse(metadata.startedAt)) / 1000 : null;
    metadata.error = "Execution did not finalize; inspect the Actions job logs for setup failure or cancellation.";
    writeMetadata(cwd, metadata);
  }
  return metadata.completed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = process.argv[2] === "--finalize" ? finalizeMutation() : await runMutation();
}
