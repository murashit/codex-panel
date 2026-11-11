import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "src/generated/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "manifest.json", "LICENSE"],
    extends: [obsidianmd.configs.recommended],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: true,
      },
    },
    rules: {
      "no-restricted-properties": ["error", { object: "Reflect", property: "get" }, { object: "Reflect", property: "apply" }],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      // Obsidian's replacement ignores its chaining `then` without weakening Promise checks.
      "@typescript-eslint/no-misused-promises": "off",
      // Allow local, explained exceptions under docs/development.md; the preset still requires descriptions.
      "eslint-comments/no-restricted-disable": "off",
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          enforceCamelCaseLower: true,
          acronyms: ["MCP"],
          brands: ["Codex", "Codex Panel", "Obsidian"],
        },
      ],
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
      "vitest/no-restricted-vi-methods": ["error", { mock: null, doMock: null }],
    },
  },
]);
