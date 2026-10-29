import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { compatibility, loadBaseline, saveBaseline } from "./baseline.mjs";

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

function finishMutation(cwd, metadata) {
  if (metadata.finishedAt) return;
  if (["running", "not_started"].includes(metadata.status)) {
    metadata.status = metadata.status === "running" ? "interrupted" : "not_started";
    metadata.error ??= "Execution did not finalize; inspect the Actions job logs for setup failure or cancellation.";
  }
  metadata.counts = null;
  try {
    metadata.counts = countReport(cwd);
  } catch (error) {
    metadata.error ??= String(error);
  }
  // A checkpoint can omit unfinished mutants. Only the final report and a
  // successful, uninterrupted process establish completion.
  metadata.completed = metadata.exitCode === 0 && metadata.status !== "interrupted" && metadata.counts?.Pending === 0;
  if (metadata.completed) {
    metadata.status = "completed";
  } else {
    metadata.error ??= `Mutation execution did not complete: exit=${metadata.exitCode}, signal=${metadata.signal}, pending=${metadata.counts?.Pending}`;
  }
  const log = resolve(cwd, reportDirectory, "mutation.log");
  const reuse = existsSync(log)
    ? stripVTControlCharacters(readFileSync(log, "utf8")).match(/Result:\s*(\d+) of \d+ mutant result\(s\) are reused/)
    : null;
  metadata.reusedMutants = reuse ? Number(reuse[1]) : metadata.reuseEnabled ? null : 0;
  metadata.finishedAt = new Date().toISOString();
  metadata.durationSeconds = metadata.startedAt ? (Date.parse(metadata.finishedAt) - Date.parse(metadata.startedAt)) / 1000 : null;
  saveBaseline(cwd, metadata);
  writeMetadata(cwd, metadata);
}

// GNU timeout signals Stryker once; the wrapper owns cleanup of its worker group.
// Keep its deadline below the Actions step/job limits so finalization can run.
async function runMutation({ force = false } = {}) {
  const cwd = process.cwd();
  const invocation = force ? [...command, "--force"] : command;
  const timeoutSeconds = 7200;
  rmSync(resolve(cwd, reportDirectory), { recursive: true, force: true });
  const metadata = initialMetadata(cwd);
  Object.assign(metadata, { status: "running", startedAt: new Date().toISOString(), command: invocation, timeoutSeconds });
  writeMetadata(cwd, metadata);
  let log;
  try {
    log = openSync(resolve(cwd, reportDirectory, "mutation.log"), "w");
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
    writeMetadata(cwd, metadata);
    console.log(
      `Full mutation run: ${invocation.join(" ")} (deadline ${timeoutSeconds}s; reuse enabled ${metadata.reuseEnabled}; log: ${reportDirectory}/mutation.log)`,
    );
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
  } catch (error) {
    if (metadata.status === "running") metadata.status = "failed";
    metadata.error = String(error);
  } finally {
    if (log !== undefined) closeSync(log);
    finishMutation(cwd, metadata);
  }
  console.log(`Mutation run ${metadata.status}; metadata: ${reportDirectory}/run.json`);
  return metadata.completed ? 0 : 1;
}

// Also runs after dependency installation failure or interrupted execution.
function finalizeMutation() {
  const cwd = process.cwd();
  const file = resolve(cwd, reportDirectory, "run.json");
  const metadata = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : initialMetadata(cwd);
  finishMutation(cwd, metadata);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Mutation run: ${metadata.status}\n\nCompleted: ${metadata.completed}\n\nBaseline: ${metadata.baseline ? JSON.stringify(metadata.baseline) : "none (cold run)"}\n\nReuse enabled: ${metadata.reuseEnabled}\n\nMutants reused: ${metadata.reusedMutants}\n\nCheckpoint saved: ${metadata.checkpointSaved}\n\nCounts: ${JSON.stringify(metadata.counts)}\n\nSee artifacts for full reports and logs.\n`,
    );
  }
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !["--force", "--finalize"].includes(args[0]))) {
  console.error("Usage: node scripts/mutation/run.mjs [--force | --finalize]");
  process.exitCode = 1;
} else if (args[0] === "--finalize") {
  finalizeMutation();
} else {
  process.exitCode = await runMutation({ force: args[0] === "--force" });
}
