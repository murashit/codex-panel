import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generatedRelativeDir = "src/generated/app-server";
const generatedHeader = "// GENERATED CODE! DO NOT MODIFY BY HAND!";
const normalizationNotice = "// This file was mechanically normalized after generation by scripts/generate-app-server-types.mjs.";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await generateAppServerTypes();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function generateAppServerTypes(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const generatedDir = path.resolve(cwd, generatedRelativeDir);
  const runCommand = options.runCommand ?? run;
  const generatedParent = path.dirname(generatedDir);
  await mkdir(generatedParent, { recursive: true });
  const stagedDir = await mkdtemp(path.join(generatedParent, ".app-server-"));
  try {
    const stagedRelativeDir = path.relative(cwd, stagedDir);
    await runCommand("codex", ["app-server", "generate-ts", "--experimental", "--out", stagedRelativeDir], { cwd });
    await normalizeGeneratedTypes(stagedDir);
    await replaceGeneratedTypes(generatedDir, stagedDir);
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw new Error(`Failed to run ${command} ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with status ${(result.status ?? 1).toString()}.`);
}
