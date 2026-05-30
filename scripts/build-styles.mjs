import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.join("src", "styles");
const manifestPath = path.join(sourceDir, "manifest.json");
const outputPath = "styles.css";
const checkMode = process.argv.includes("--check");
const validArgs = new Set(["--check"]);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const arg of process.argv.slice(2)) {
    if (!validArgs.has(arg)) {
      console.error("Usage: node scripts/build-styles.mjs [--check]");
      process.exit(1);
    }
  }

  if (checkMode) {
    await checkStyles();
  } else {
    await buildStyles();
  }
}

export async function buildStyles() {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await renderStyles());
}

async function checkStyles() {
  await checkStyleManifest();
  await renderStyles();
}

export async function renderStyles() {
  const parts = [];

  const sourceFiles = await readStyleManifest();
  for (const file of sourceFiles) {
    const content = await readFile(path.join(sourceDir, file), "utf8");
    parts.push(content.trimEnd());
  }

  return `${parts.join("\n\n")}\n`;
}

async function readStyleManifest() {
  const value = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${manifestPath} must be a JSON array of CSS file names.`);
  }
  return value;
}

async function checkStyleManifest() {
  const sourceFiles = await readStyleManifest();
  const listed = new Set(sourceFiles);
  const duplicates = sourceFiles.filter((file, index) => sourceFiles.indexOf(file) !== index);
  const actual = (await readdir(sourceDir)).filter((file) => file.endsWith(".css")).sort((left, right) => left.localeCompare(right));

  const missing = sourceFiles.filter((file) => !actual.includes(file));
  const unlisted = actual.filter((file) => !listed.has(file));

  if (duplicates.length === 0 && missing.length === 0 && unlisted.length === 0) return;

  if (duplicates.length > 0) console.error(`Duplicate entries in ${manifestPath}: ${[...new Set(duplicates)].join(", ")}`);
  if (missing.length > 0) console.error(`Listed CSS files missing from ${sourceDir}: ${missing.join(", ")}`);
  if (unlisted.length > 0) console.error(`CSS files missing from ${manifestPath}: ${unlisted.join(", ")}`);
  process.exit(1);
}
