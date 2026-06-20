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
  const formatArgs = ciMode ? "--check" : "--check --cache";

  return [
    { name: "typecheck", command: `npm run --silent typecheck${suffix}` },
    { name: "test", command: `npm run --silent test${suffix}` },
    ...lintCommands({ ciMode, namePrefix: "lint:" }),
    { name: "format:check", command: `node scripts/format.mjs ${formatArgs}` },
  ];
}

function lintCommands({ ciMode, namePrefix = "" }) {
  const eslintCacheArgs = ciMode ? "" : " --cache --cache-strategy content --cache-location node_modules/.cache/eslint/.eslintcache";

  return [
    {
      name: `${namePrefix}ts`,
      command: `eslint src tests scripts "*.config.ts" "*.config.mjs" --max-warnings=0${eslintCacheArgs}`,
    },
    { name: `${namePrefix}css`, command: 'stylelint "src/**/*.css" --max-warnings=0' },
    { name: `${namePrefix}css-usage`, command: "node scripts/lint/check-css-usage.mjs" },
    { name: `${namePrefix}deps`, command: "node scripts/lint/check-import-cycles.mjs" },
    { name: `${namePrefix}unused`, command: "knip --no-progress" },
  ];
}
