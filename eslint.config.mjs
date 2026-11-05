import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const sourceTypeScriptFiles = ["src/**/*.{ts,tsx}"];

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "src/generated/**"],
  },
  {
    basePath: "src",
    plugins: {
      obsidianmd,
    },
  },
  ...obsidianmd.configs.recommended.map(obsidianRecommendedConfig).filter(Boolean),
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: sourceTypeScriptFiles,
  })),
  {
    files: sourceTypeScriptFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: true,
      },
      globals: {
        AbortSignal: "readonly",
        HTMLElement: "readonly",
        HTMLTextAreaElement: "readonly",
        KeyboardEvent: "readonly",
        NodeJS: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      // Biome import restrictions do not cover `import("...").T`; keep that type syntax out before source-boundary lint runs.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: true,
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    ...vitest.configs.recommended,
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "assert",
            "expectAllowedOperations",
            "expectNotificationRouteKind",
            "expectRequestRouteKind",
            "expectRequestTimes",
          ],
        },
      ],
      // Vitest supports a second argument for assertion failure context.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/prefer-hooks-in-order": "error",
    },
  },
]);

function obsidianRecommendedConfig(config) {
  if (config.rules?.["obsidianmd/validate-manifest"] || config.rules?.["obsidianmd/validate-license"]) {
    return {
      ...config,
      rules: Object.fromEntries(Object.keys(config.rules).map((rule) => [rule, "error"])),
    };
  }

  const rules = Object.fromEntries(
    Object.entries(config.rules ?? {})
      .filter(([ruleName]) => {
        return (
          ruleName.startsWith("obsidianmd/") && ruleName !== "obsidianmd/validate-manifest" && ruleName !== "obsidianmd/validate-license"
        );
      })
      .map(([ruleName, ruleConfig]) => {
        if (ruleName !== "obsidianmd/ui/sentence-case") return [ruleName, ruleConfig];
        return [
          ruleName,
          [
            "error",
            {
              enforceCamelCaseLower: true,
              acronyms: ["MCP"],
              brands: ["Codex", "Codex Panel", "Obsidian"],
            },
          ],
        ];
      }),
  );
  if (Object.keys(rules).length === 0) return null;
  const obsidianConfig = {
    basePath: "src",
    rules,
  };
  if (config.files) obsidianConfig.files = config.files;
  if (config.ignores) obsidianConfig.ignores = config.ignores;
  return obsidianConfig;
}
