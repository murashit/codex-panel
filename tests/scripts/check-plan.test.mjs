import { describe, expect, it } from "vitest";
import { commandPlan } from "../../scripts/check-plan.mjs";

describe("check command plan", () => {
  it("runs the local preflight checks before the build", () => {
    expect(commandPlan({ ciMode: false, lintOnly: false }).phases).toEqual([
      {
        name: "check",
        commands: [
          { name: "typecheck", command: "npm run --silent typecheck" },
          { name: "test", command: "npm run --silent test" },
          { name: "lint:biome", command: "biome check --no-errors-on-unmatched --diagnostic-level=warn --error-on-warnings" },
          {
            name: "lint:eslint",
            command:
              "eslint src --max-warnings=0 --cache --cache-strategy content --cache-location node_modules/.cache/eslint/.eslintcache",
          },
          { name: "lint:css", command: 'stylelint "src/**/*.css" --max-warnings=0' },
          { name: "lint:css-usage", command: "node scripts/lint/check-css-usage.mjs" },
          { name: "lint:unused", command: "knip --no-progress" },
        ],
      },
      {
        name: "build",
        commands: [{ name: "build", command: "node esbuild.config.mjs" }],
      },
    ]);
  });

  it("keeps lint-only mode on Biome lint", () => {
    expect(commandPlan({ ciMode: false, lintOnly: true }).phases[0]).toEqual({
      name: "lint",
      commands: expect.arrayContaining([
        {
          name: "biome",
          command: "biome lint --no-errors-on-unmatched --diagnostic-level=warn --error-on-warnings",
        },
      ]),
    });
  });

  it("omits cache-only local flags in CI mode", () => {
    expect(commandPlan({ ciMode: true, lintOnly: false }).phases[0]?.commands).toContainEqual({
      name: "lint:eslint",
      command: "eslint src --max-warnings=0",
    });
  });
});
