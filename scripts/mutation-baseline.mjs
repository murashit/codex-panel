import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, matchesGlob, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import config from "../stryker.config.mjs";

export const checkpoint = config.incrementalFile;
const directory = dirname(checkpoint);
const hash = (content) => createHash("sha256").update(content).digest("hex");

// Stryker owns changes to mutated source and individual test files. Everything
// else that can affect those tests must invalidate reuse, including removals.
export function compatibility(cwd = process.cwd()) {
  const files = globSync(["src/**/*", "tests/**/*", "scripts/**/*", "*", ".node-version", ".npmrc", ".github/workflows/mutation.yml"], {
    cwd,
  })
    .filter((file) => statSync(resolve(cwd, file)).isFile())
    .filter(
      (file) =>
        file.startsWith("src/") ||
        file.startsWith("tests/") ||
        file.startsWith("scripts/") ||
        /(?:config\.|\.json$|\.jsonc$|^\.node-version$|^\.npmrc$|^\.github\/)/.test(file),
    )
    .filter((file) => !config.mutate.some((pattern) => matchesGlob(file, pattern)) && !/\.test\.[cm]?[jt]sx?$/.test(file))
    .sort();
  const versions = { node: process.version, platform: process.platform, arch: process.arch };
  for (const name of ["@stryker-mutator/core", "@stryker-mutator/vitest-runner", "vitest"]) {
    versions[name] = JSON.parse(readFileSync(resolve(cwd, "node_modules", name, "package.json"), "utf8")).version;
  }
  const environment = Object.fromEntries(["CI", "NODE_OPTIONS", "TZ", "LANG"].map((name) => [name, process.env[name] ?? null]));
  const inputs = Object.fromEntries(files.map((file) => [file, hash(readFileSync(resolve(cwd, file)))]));
  return { schemaVersion: 1, versions, environment, inputs, key: hash(JSON.stringify({ versions, environment, inputs })) };
}

export function readCheckpoint(content) {
  const report = JSON.parse(content);
  if (
    report.schemaVersion !== "1.0" ||
    !report.files ||
    typeof report.files !== "object" ||
    Array.isArray(report.files) ||
    !report.testFiles ||
    typeof report.testFiles !== "object" ||
    Array.isArray(report.testFiles)
  ) {
    throw new Error("Unsupported incremental report");
  }
  for (const [name, file] of Object.entries(report.files)) {
    if (!name.startsWith("src/") || name.split(/[\\/]/).includes("..") || typeof file.source !== "string" || !Array.isArray(file.mutants)) {
      throw new Error("Invalid incremental source file");
    }
    for (const mutant of file.mutants) {
      if (
        typeof mutant.id !== "string" ||
        !["Killed", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Timeout", "Ignored", "Pending"].includes(mutant.status) ||
        !validLocation(mutant.location)
      )
        throw new Error("Invalid incremental mutant");
    }
  }
  for (const [name, file] of Object.entries(report.testFiles)) {
    if (
      !name.startsWith("tests/") ||
      name.split(/[\\/]/).includes("..") ||
      typeof file.source !== "string" ||
      !Array.isArray(file.tests) ||
      file.tests.some(
        (test) => typeof test.id !== "string" || typeof test.name !== "string" || (test.location && !validLocation(test.location, true)),
      )
    ) {
      throw new Error("Invalid incremental test file");
    }
  }
  return report;
}

function validLocation(location, endOptional = false) {
  const positions = endOptional && !location?.end ? [location?.start] : [location?.start, location?.end];
  return positions.every(
    (position) => Number.isInteger(position?.line) && position.line > 0 && Number.isInteger(position?.column) && position.column >= 0,
  );
}

export function loadBaseline(cwd, expected) {
  try {
    const metadata = JSON.parse(readFileSync(resolve(cwd, directory, "baseline.json"), "utf8"));
    const content = readFileSync(resolve(cwd, checkpoint));
    readCheckpoint(content);
    if (metadata.schemaVersion !== 1 || metadata.compatibility.key !== expected.key || metadata.checkpointHash !== hash(content)) {
      throw new Error("Baseline compatibility or checkpoint hash mismatch");
    }
    return metadata;
  } catch (error) {
    rmSync(resolve(cwd, checkpoint), { force: true });
    console.log(`Cold mutation run: ${error.message}`);
    return null;
  }
}

export function saveBaseline(cwd, metadata) {
  try {
    const content = readFileSync(resolve(cwd, checkpoint));
    readCheckpoint(content);
    mkdirSync(resolve(cwd, directory), { recursive: true });
    writeFileSync(
      resolve(cwd, directory, "baseline.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          compatibility: metadata.compatibility,
          checkpointHash: hash(content),
          commit: metadata.commit,
          runId: metadata.runId,
          runAttempt: metadata.runAttempt,
          completed: metadata.completed,
          status: metadata.status,
        },
        null,
        2,
      )}\n`,
    );
    metadata.checkpointSaved = true;
  } catch (error) {
    metadata.checkpointSaved = false;
    metadata.checkpointError = error.message;
    rmSync(resolve(cwd, directory), { recursive: true, force: true });
  }
}

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "manual",
  });
  if (response.status === 302) {
    const url = new URL(response.headers.get("location"));
    if (url.protocol !== "https:") throw new Error("Non-HTTPS artifact redirect");
    const download = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!download.ok) throw new Error(`Artifact download: HTTP ${download.status}`);
    return Buffer.from(await download.arrayBuffer());
  }
  if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
  return response.json();
}

// Read only the two expected regular files, never extract archive-controlled paths.
function readArchive(archive) {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import io, json, stat, sys, zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
    names = ['baseline.json', 'stryker-incremental.json']
    if sorted(z.namelist()) != sorted(names): raise ValueError('Unexpected archive entries')
    for name in names:
        entry = z.getinfo(name)
        if entry.file_size > 100 * 1024 * 1024 or stat.S_ISLNK(entry.external_attr >> 16): raise ValueError('Unsafe archive entry')
    print(json.dumps({name: z.read(name).decode('utf-8') for name in names}))
`,
    ],
    { input: archive, maxBuffer: 220 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error("Invalid baseline archive");
  return JSON.parse(result.stdout);
}

export async function restoreBaseline(cwd = process.cwd()) {
  rmSync(resolve(cwd, directory), { recursive: true, force: true });
  const expected = compatibility(cwd);
  if (!process.env.GITHUB_TOKEN) throw new Error("Baseline restore requires GITHUB_TOKEN");
  const current = await api(`actions/runs/${process.env.GITHUB_RUN_ID}`);
  // Repository artifacts are newest first, including reruns of older runs.
  for (let page = 1; ; page++) {
    const { artifacts } = await api(`actions/artifacts?per_page=100&page=${page}`);
    for (const artifact of artifacts) {
      if (artifact.expired || !/^mutation-baseline-\d+-\d+$/.test(artifact.name)) continue;
      try {
        const run = await api(`actions/runs/${artifact.workflow_run.id}`);
        if (
          String(run.id) === process.env.GITHUB_RUN_ID ||
          run.workflow_id !== current.workflow_id ||
          run.status !== "completed" ||
          run.head_branch !== "main" ||
          run.head_repository?.full_name !== process.env.GITHUB_REPOSITORY ||
          !["schedule", "workflow_dispatch"].includes(run.event)
        )
          continue;
        if (artifact.size_in_bytes > 100 * 1024 * 1024) throw new Error("Oversized baseline archive");
        const files = readArchive(await api(`actions/artifacts/${artifact.id}/zip`));
        const metadata = JSON.parse(files["baseline.json"]);
        const content = files["stryker-incremental.json"];
        readCheckpoint(content);
        if (
          metadata.schemaVersion !== 1 ||
          metadata.compatibility.key !== expected.key ||
          metadata.checkpointHash !== hash(content) ||
          metadata.commit !== run.head_sha ||
          String(metadata.runId) !== String(run.id) ||
          artifact.name !== `mutation-baseline-${run.id}-${metadata.runAttempt}`
        )
          throw new Error("Incompatible baseline or provenance");
        metadata.artifactId = artifact.id;
        mkdirSync(resolve(cwd, directory), { recursive: true });
        writeFileSync(resolve(cwd, directory, "baseline.json"), JSON.stringify(metadata));
        writeFileSync(resolve(cwd, checkpoint), content);
        console.log(`Restored baseline artifact ${artifact.id} from run ${run.id} (${metadata.completed ? "complete" : "incomplete"})`);
        return;
      } catch (error) {
        console.log(`Skipped baseline artifact ${artifact.id}: ${error.message}`);
      }
    }
    if (artifacts.length < 100) break;
  }
  console.log("No compatible trusted baseline found; next mutation run will be cold.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await restoreBaseline();
}
