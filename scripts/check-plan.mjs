export const biomeLintCommand = "biome lint --no-errors-on-unmatched --diagnostic-level=warn --error-on-warnings";
export const biomeCheckCommand = "biome check --no-errors-on-unmatched --diagnostic-level=warn --error-on-warnings";

export function commandPlan({ ciMode, lintOnly }) {
  if (lintOnly) {
    return {
      phases: [{ name: "lint", commands: lintCommands({ ciMode }) }],
    };
  }

  return {
    phases: [
      { name: "check", commands: checkCommands({ ciMode }) },
      { name: "build", commands: [{ name: "build", command: "node esbuild.config.mjs" }] },
    ],
  };
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
      command: `eslint src --max-warnings=0${eslintCacheArgs}`,
    },
    { name: `${namePrefix}css-usage`, command: "node scripts/lint/check-css-usage.mjs" },
    { name: `${namePrefix}unused`, command: "knip --no-progress" },
  ];
}
