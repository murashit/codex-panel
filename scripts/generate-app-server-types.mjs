import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const generatedDir = path.resolve("src/generated/app-server");
const generatedHeader = "// GENERATED CODE! DO NOT MODIFY BY HAND!";
const normalizationNotice = "// This file was mechanically normalized after generation by scripts/generate-app-server-types.mjs.";

await cleanGeneratedTypes();
run("codex", ["app-server", "generate-ts", "--experimental", "--out", "src/generated/app-server"]);
await normalizeGeneratedTypes();

async function cleanGeneratedTypes() {
  await rm(generatedDir, { recursive: true, force: true });
  await mkdir(generatedDir, { recursive: true });
}

async function normalizeGeneratedTypes() {
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

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`Failed to run ${command} ${args.join(" ")}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
