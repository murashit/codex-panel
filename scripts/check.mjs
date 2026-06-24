import concurrently from "concurrently";

const args = process.argv.slice(2);
const validArgs = new Set(["--ci", "--lint"]);
const unknownArgs = args.filter((arg) => !validArgs.has(arg));

if (unknownArgs.length > 0) {
  console.error("Usage: node scripts/check.mjs [--ci] [--lint]");
  process.exit(1);
}

const ciMode = args.includes("--ci");
const lintOnly = args.includes("--lint");
const concurrentOptions = {
  group: true,
  padPrefix: true,
  prefix: "name",
};
const biomeLintCommand = "biome lint --no-errors-on-unmatched --diagnostic-level=warn --error-on-warnings";
const biomeCheckCommand = "biome check --no-errors-on-unmatched --diagnostic-level=warn --error-on-warnings";

try {
  if (lintOnly) {
    await runConcurrently(lintCommands({ ciMode }));
  } else {
    await runConcurrently(checkCommands({ ciMode }));
    await runConcurrently([{ name: "build", command: "node esbuild.config.mjs" }]);
  }
} catch {
  process.exit(1);
}

async function runConcurrently(commands) {
  await concurrently(commands, concurrentOptions).result;
}

function checkCommands({ ciMode }) {
  const suffix = ciMode ? ":ci" : "";

  return [
    { name: "typecheck", command: `npm run --silent typecheck${suffix}` },
    { name: "test", command: `npm run --silent test${suffix}` },
    { name: "lint:biome", command: biomeCheckCommand },
    ...nonBiomeLintCommands({ ciMode, namePrefix: "lint:" }),
  ];
}

function lintCommands({ ciMode, namePrefix = "" }) {
  return [{ name: `${namePrefix}biome`, command: biomeLintCommand }, ...nonBiomeLintCommands({ ciMode, namePrefix })];
}

function nonBiomeLintCommands({ ciMode, namePrefix = "" }) {
  const eslintCacheArgs = ciMode ? "" : " --cache --cache-strategy content --cache-location node_modules/.cache/eslint/.eslintcache";

  return [
    {
      name: `${namePrefix}eslint`,
      command: `eslint src tests scripts "*.config.ts" "*.config.mjs" --max-warnings=0${eslintCacheArgs}`,
    },
    { name: `${namePrefix}css`, command: 'stylelint "src/**/*.css" --max-warnings=0' },
    { name: `${namePrefix}css-usage`, command: "node scripts/lint/check-css-usage.mjs" },
    { name: `${namePrefix}unused`, command: "knip --no-progress" },
  ];
}
