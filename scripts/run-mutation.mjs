import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { compatibility, loadBaseline, saveBaseline } from "./mutation-baseline.mjs";

const reportDirectory = "reports/mutation";
const statuses = ["Killed", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Timeout", "Ignored", "Pending"];
const command = [
  process.execPath,
  "node_modules/@stryker-mutator/core/bin/stryker.js",
  "run",
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
  const versions = { node: process.version };
  for (const name of ["@stryker-mutator/core", "@stryker-mutator/vitest-runner", "vitest"]) {
    const file = resolve(cwd, "node_modules", name, "package.json");
    versions[name] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : null;
  }
  return {
    schemaVersion: 2,
    commit: process.env.GITHUB_SHA ?? null,
    source: process.env.GITHUB_SHA ? "github-checkout" : "local-working-copy",
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    versions,
    compatibility: null,
    baseline: null,
    reuseEnabled: false,
    reusedMutants: null,
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

// GNU timeout signals Stryker once; the wrapper owns cleanup of its worker group.
// Keep its deadline below the Actions step/job limits so finalization can run.
export async function runMutation({ cwd = process.cwd(), invocation = command, timeoutSeconds = 7200, force = false } = {}) {
  rmSync(resolve(cwd, reportDirectory), { recursive: true, force: true });
  const metadata = initialMetadata(cwd);
  metadata.compatibility = compatibility(cwd);
  const baseline = loadBaseline(cwd, metadata.compatibility);
  metadata.baseline = baseline
    ? {
        commit: baseline.commit,
        runId: baseline.runId,
        runAttempt: baseline.runAttempt,
        artifactId: baseline.artifactId ?? null,
        completed: baseline.completed,
      }
    : null;
  metadata.reuseEnabled = Boolean(baseline) && !force;
  metadata.force = force;
  if (force) invocation = [...invocation, "--force"];
  const started = Date.now();
  Object.assign(metadata, { status: "running", startedAt: new Date(started).toISOString(), command: invocation, timeoutSeconds });
  writeMetadata(cwd, metadata);
  const log = openSync(resolve(cwd, reportDirectory, "mutation.log"), "w");
  console.log(
    `Full mutation run: ${invocation.join(" ")} (deadline ${timeoutSeconds}s; reuse enabled ${metadata.reuseEnabled}; log: ${reportDirectory}/mutation.log)`,
  );
  try {
    const result = await new Promise((resolveResult, reject) => {
      // Child reporters can write megabytes of output to the Actions summary.
      // Keep full output in mutation.log and write our own bounded summary.
      const env = { ...process.env };
      delete env.GITHUB_STEP_SUMMARY;
      const child = spawn("timeout", ["--foreground", "--kill-after=60s", `${timeoutSeconds}s`, ...invocation], {
        cwd,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let interrupted = false;
      const interrupt = () => {
        if (interrupted) return;
        interrupted = true;
        child.kill("SIGTERM");
      };
      const removeHandlers = () => {
        process.off("SIGTERM", interrupt);
        process.off("SIGINT", interrupt);
      };
      process.on("SIGTERM", interrupt);
      process.on("SIGINT", interrupt);
      // Default timeout signals both the child and its group, which can trigger
      // Stryker's second-signal forced exit before its checkpoint is written.
      // Foreground mode signals only Stryker; clean up workers after it exits,
      // before inherited output pipes can keep the close event waiting.
      child.once("exit", () => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") console.error(`Worker cleanup failed: ${error.message}`);
        }
      });
      for (const output of [child.stdout, child.stderr]) {
        output.on("data", (chunk) => {
          writeSync(log, chunk);
          process.stdout.write(chunk);
        });
      }
      child.once("error", (error) => {
        removeHandlers();
        reject(error);
      });
      child.once("close", (code, signal) => {
        removeHandlers();
        resolveResult({ code, signal, interrupted });
      });
    });
    metadata.exitCode = result.code;
    metadata.signal = result.signal;
    metadata.status = result.interrupted ? "interrupted" : result.code === 124 ? "timed_out" : "failed";
    // Keep partial counts useful, but never treat a nonzero exit as completion.
    metadata.counts = countReport(cwd);
    if (!result.interrupted && result.code === 0 && metadata.counts.Pending === 0) {
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
    const reuse = stripVTControlCharacters(readFileSync(resolve(cwd, reportDirectory, "mutation.log"), "utf8")).match(
      /Result:\s*(\d+) of \d+ mutant result\(s\) are reused/,
    );
    metadata.reusedMutants = reuse ? Number(reuse[1]) : metadata.reuseEnabled ? null : 0;
    metadata.finishedAt = new Date().toISOString();
    metadata.durationSeconds = (Date.now() - started) / 1000;
    saveBaseline(cwd, metadata);
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
  }
  saveBaseline(cwd, metadata);
  writeMetadata(cwd, metadata);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Mutation run: ${metadata.status}\n\nCompleted: ${metadata.completed}\n\nBaseline: ${metadata.baseline ? JSON.stringify(metadata.baseline) : "none (cold run)"}\n\nReuse enabled: ${metadata.reuseEnabled}\n\nMutants reused: ${metadata.reusedMutants}\n\nCheckpoint saved: ${metadata.checkpointSaved}\n\nCounts: ${JSON.stringify(metadata.counts)}\n\nSee artifacts for full reports and logs.\n`,
    );
  }
  return metadata.completed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = process.argv[2] === "--finalize" ? finalizeMutation() : await runMutation({ force: process.argv.includes("--force") });
}
