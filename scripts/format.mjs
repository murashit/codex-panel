import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".md"]);
const scriptExtensions = new Set([".js", ".mjs"]);
const rootExtensions = new Set([".ts", ".json", ".mjs", ".md", ".css"]);

const args = process.argv.slice(2);
const shouldCheck = args.includes("--check");
const shouldUseCache = args.includes("--cache");
const cacheLocation = argumentValue("--cache-location") ?? "node_modules/.cache/prettier/.prettier-cache";
const root = process.cwd();
const files = await formatFiles();
const cache = shouldCheck && shouldUseCache ? await readCache(cacheLocation) : new Map();
const nextCache = new Map(cache);
const unformattedFiles = [];
let hadError = false;

for (const file of files) {
  try {
    const info = await prettier.getFileInfo(file, { ignorePath: path.join(root, ".prettierignore") });
    if (info.ignored || info.inferredParser === null) continue;

    const input = await readFile(file, "utf8");
    const config = (await prettier.resolveConfig(file)) ?? {};
    const cacheKey = path.relative(root, file);
    const cacheHash = hashFormatInput(input, config, info.inferredParser);
    if (shouldCheck && cache.get(cacheKey) === cacheHash) continue;

    const output = await prettier.format(input, { ...config, filepath: file });

    if (output === input) {
      nextCache.set(cacheKey, cacheHash);
      continue;
    }
    if (shouldCheck) {
      nextCache.delete(cacheKey);
      unformattedFiles.push(cacheKey);
      continue;
    }
    await writeFile(file, output);
    console.log(path.relative(root, file));
  } catch (error) {
    hadError = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${path.relative(root, file)}: ${message}`);
  }
}

if (shouldCheck && shouldUseCache) await writeCache(cacheLocation, nextCache);
if (unformattedFiles.length > 0) {
  console.error("Unformatted files:");
  for (const file of unformattedFiles) console.error(file);
  process.exit(1);
}
if (hadError) process.exit(1);

function argumentValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

async function readCache(file) {
  try {
    const value = JSON.parse(await readFile(path.join(root, file), "utf8"));
    return new Map(Object.entries(value.files ?? {}));
  } catch {
    return new Map();
  }
}

async function writeCache(file, cacheEntries) {
  const absoluteFile = path.join(root, file);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  const files = Object.fromEntries([...cacheEntries.entries()].sort(([left], [right]) => left.localeCompare(right)));
  await writeFile(absoluteFile, `${JSON.stringify({ version: 1, files })}\n`);
}

function hashFormatInput(input, config, inferredParser) {
  return createHash("sha256")
    .update(prettier.version)
    .update("\0")
    .update(inferredParser ?? "")
    .update("\0")
    .update(JSON.stringify(config))
    .update("\0")
    .update(input)
    .digest("hex");
}

async function formatFiles() {
  const result = [
    ...(await filesInTree("src", sourceExtensions, { excludedPrefixes: ["src/generated"] })),
    ...(await filesInTree("tests", sourceExtensions)),
    ...(await filesInTree("scripts", scriptExtensions)),
    ...(await rootFiles(rootExtensions)),
  ];
  return [...new Set(result)].sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));
}

async function rootFiles(extensions) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name))).map((entry) => path.join(root, entry.name));
}

async function filesInTree(relativeDirectory, extensions, options = {}) {
  const directory = path.join(root, relativeDirectory);
  const excludedPrefixes = options.excludedPrefixes?.map((prefix) => path.join(root, prefix)) ?? [];
  const result = [];
  await collectFiles(directory, extensions, excludedPrefixes, result);
  return result;
}

async function collectFiles(directory, extensions, excludedPrefixes, result) {
  if (excludedPrefixes.some((prefix) => directory === prefix || directory.startsWith(`${prefix}${path.sep}`))) return;

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(file, extensions, excludedPrefixes, result);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      result.push(file);
    }
  }
}
