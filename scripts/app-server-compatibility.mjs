import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compatibilityRelativePath = "src/app-server/connection/compatibility.json";
const exactSemverPattern = /^\d+\.\d+\.\d+$/;

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--tested-cli-version") {
    console.error("Usage: node scripts/app-server-compatibility.mjs --tested-cli-version");
    process.exit(1);
  }

  try {
    const policy = await readAppServerGenerationPolicy(process.cwd());
    console.log(policy.testedCliVersion);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function readAppServerGenerationPolicy(cwd) {
  const compatibilityPath = path.join(cwd, compatibilityRelativePath);
  const compatibility = JSON.parse(await readFile(compatibilityPath, "utf8"));
  const testedCliVersion = compatibility.codexAppServer?.testedCliVersion;
  const generationArguments = compatibility.codexAppServer?.typeGeneration?.arguments;

  if (typeof testedCliVersion !== "string" || !exactSemverPattern.test(testedCliVersion)) {
    throw new Error(`${compatibilityRelativePath} must declare codexAppServer.testedCliVersion as X.Y.Z.`);
  }
  if (!isStringArray(generationArguments) || generationArguments.length === 0) {
    throw new Error(`${compatibilityRelativePath} must declare codexAppServer.typeGeneration.arguments as a non-empty string array.`);
  }
  if (generationArguments.includes("--out")) {
    throw new Error(`${compatibilityRelativePath} must not include --out in codexAppServer.typeGeneration.arguments.`);
  }

  return { generationArguments, testedCliVersion };
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function isMain() {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}
