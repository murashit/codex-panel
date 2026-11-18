import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.join("src", "styles");
const outputPath = "styles.css";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error("Usage: node scripts/styles/build.mjs");
    process.exit(1);
  }
  await buildStyles();
}

export async function buildStyles() {
  const sourceFiles = await readStyleFiles();
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const parts = [];

  for (const file of sourceFiles) {
    const content = await readFile(file, "utf8");
    parts.push(content.trimEnd());
  }

  await writeFile(outputPath, `/* Codex Panel v${version} */\n\n${parts.join("\n\n")}\n`);
}

export async function readStyleFiles() {
  return (await readdir(sourceDir))
    .filter((file) => file.endsWith(".css"))
    .sort()
    .map((file) => path.join(sourceDir, file));
}
