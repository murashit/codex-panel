import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.join("src", "styles");
const orderPath = path.join(sourceDir, "order.json");
const outputPath = "styles.css";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error("Usage: node scripts/build-styles.mjs");
    process.exit(1);
  }
  await buildStyles();
}

export async function buildStyles() {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await renderStyles());
}

export async function renderStyles() {
  const sourceFiles = await readStyleFiles();
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const parts = [];

  for (const file of sourceFiles) {
    const content = await readFile(file, "utf8");
    parts.push(content.trimEnd());
  }

  return `/* Codex Panel v${version} */\n\n${parts.join("\n\n")}\n`;
}

export async function readStyleFiles() {
  const sourceFiles = JSON.parse(await readFile(orderPath, "utf8"));
  if (!Array.isArray(sourceFiles) || !sourceFiles.every((item) => typeof item === "string")) {
    throw new Error(`${orderPath} must be a JSON array of CSS file names.`);
  }
  const listed = new Set(sourceFiles);
  const duplicates = sourceFiles.filter((file, index) => sourceFiles.indexOf(file) !== index);
  const actual = (await readdir(sourceDir)).filter((file) => file.endsWith(".css")).sort((left, right) => left.localeCompare(right));

  const missing = sourceFiles.filter((file) => !actual.includes(file));
  const unlisted = actual.filter((file) => !listed.has(file));

  const errors = [];
  if (duplicates.length > 0) errors.push(`Duplicate entries in ${orderPath}: ${[...new Set(duplicates)].join(", ")}`);
  if (missing.length > 0) errors.push(`Listed CSS files missing from ${sourceDir}: ${missing.join(", ")}`);
  if (unlisted.length > 0) errors.push(`CSS files missing from ${orderPath}: ${unlisted.join(", ")}`);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return sourceFiles.map((file) => path.join(sourceDir, file));
}
