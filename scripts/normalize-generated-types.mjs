import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const generatedDir = path.resolve("src/generated/app-server");
const generatedHeader = "// GENERATED CODE! DO NOT MODIFY BY HAND!";
const normalizationNotice = "// This file was mechanically normalized after generation by scripts/normalize-generated-types.mjs.";

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

const files = await listTypeScriptFiles(generatedDir);

await Promise.all(
  files.map(async (file) => {
    const source = await readFile(file, "utf8");
    const normalized = normalizeSource(source);
    const nextSource = normalized === source ? source : addNormalizationNotice(normalized);
    if (nextSource !== source) await writeFile(file, nextSource);
  }),
);
