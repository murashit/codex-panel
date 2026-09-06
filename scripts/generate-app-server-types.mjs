import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAppServerGenerationPolicy } from "./app-server-compatibility.mjs";

const generatedRelativeDir = "src/generated/app-server";
const generatedHeader = "// GENERATED CODE! DO NOT MODIFY BY HAND!";
const normalizationNotice = "// This file was mechanically normalized after generation by scripts/generate-app-server-types.mjs.";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check") || args.length > 1) {
    throw new Error("Usage: node scripts/generate-app-server-types.mjs [--check]");
  }
  await generateAppServerTypes(args.includes("--check"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function generateAppServerTypes(check) {
  const cwd = process.cwd();
  const generatedDir = path.resolve(cwd, generatedRelativeDir);
  const policy = await readAppServerGenerationPolicy(cwd);
  const installedCliVersion = readInstalledCodexVersion(cwd);
  if (installedCliVersion !== policy.testedCliVersion) {
    throw new Error(
      `Codex CLI ${policy.testedCliVersion} is required to generate app-server bindings; found ${installedCliVersion ?? "an unreadable version"}.`,
    );
  }
  const generatedParent = path.dirname(generatedDir);
  await mkdir(generatedParent, { recursive: true });
  const stagedDir = await mkdtemp(path.join(generatedParent, ".app-server-"));
  try {
    const stagedRelativeDir = path.relative(cwd, stagedDir);
    run("codex", [...policy.generationArguments, "--out", stagedRelativeDir], cwd);
    await normalizeGeneratedTypes(stagedDir);
    if (check) {
      const differences = await compareGeneratedTrees(generatedDir, stagedDir);
      if (differences.length > 0) {
        throw new Error(`generated app-server bindings are out of date:\n${differences.map((difference) => `  ${difference}`).join("\n")}`);
      }
    } else {
      await replaceGeneratedTypes(generatedDir, stagedDir);
    }
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
}

async function compareGeneratedTrees(trackedDir, stagedDir) {
  const [trackedFiles, stagedFiles] = await Promise.all([listFiles(trackedDir), listFiles(stagedDir)]);
  const trackedSet = new Set(trackedFiles);
  const stagedSet = new Set(stagedFiles);
  const differences = [];

  for (const file of stagedFiles) {
    if (!trackedSet.has(file)) {
      differences.push(`added: ${file}`);
      continue;
    }
    const [trackedSource, stagedSource] = await Promise.all([readFile(path.join(trackedDir, file)), readFile(path.join(stagedDir, file))]);
    if (!trackedSource.equals(stagedSource)) differences.push(`changed: ${file}`);
  }
  for (const file of trackedFiles) {
    if (!stagedSet.has(file)) differences.push(`removed: ${file}`);
  }

  return differences;
}

async function replaceGeneratedTypes(generatedDir, stagedDir) {
  const backupDir = `${generatedDir}.backup-${process.pid.toString()}-${Date.now().toString()}`;
  let hasBackup = false;
  try {
    try {
      await rename(generatedDir, backupDir);
      hasBackup = true;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    await rename(stagedDir, generatedDir);
    if (hasBackup) await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (hasBackup) {
      await rm(generatedDir, { recursive: true, force: true });
      await rename(backupDir, generatedDir);
    }
    throw error;
  }
}

function isMissingPathError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function normalizeGeneratedTypes(generatedDir) {
  const files = await listTypeScriptFiles(generatedDir);

  await Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, "utf8");
      const normalized = normalizeSource(source);
      const nextSource = normalized === source ? source : addNormalizationNotice(normalized);
      if (nextSource !== source) await writeFile(file, nextSource);
    }),
  );
}

async function listTypeScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(fullPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
    }),
  );
  return files.flat();
}

async function listFiles(dir, relativeDir = "") {
  let entries;
  try {
    entries = await readdir(path.join(dir, relativeDir), { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  const files = await Promise.all(
    entries.map((entry) => {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) return listFiles(dir, relativePath);
      return entry.isFile() ? [relativePath.replaceAll(path.sep, "/")] : [];
    }),
  );
  return files.flat().sort();
}

function normalizeSource(source) {
  let normalized = source;
  do {
    source = normalized;
    normalized = source.replaceAll("| null | null", "| null");
  } while (normalized !== source);
  return normalized;
}

function addNormalizationNotice(source) {
  if (source.includes(normalizationNotice)) return source;
  if (!source.startsWith(generatedHeader)) return source;
  return source.replace(generatedHeader, `${generatedHeader}\n${normalizationNotice}`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw new Error(`Failed to run ${command} ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with status ${(result.status ?? 1).toString()}.`);
}

function readInstalledCodexVersion(cwd) {
  const result = spawnSync("codex", ["--version"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout}\n${result.stderr}`.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
}
