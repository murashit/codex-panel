import json from "@eslint/json";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { PlainTextParser } from "eslint-plugin-obsidianmd/dist/lib/plainTextParser.js";
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
  ...obsidianmd.configs.recommended.map(obsidianSourceRecommendedConfig).filter(Boolean),
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
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["manifest.json"],
    plugins: {
      json,
      obsidianmd,
    },
    language: "json/json",
    rules: {
      "obsidianmd/validate-manifest": "error",
    },
  },
  {
    files: ["LICENSE"],
    plugins: {
      obsidianmd,
    },
    languageOptions: {
      parser: PlainTextParser,
    },
    rules: {
      "obsidianmd/validate-license": "error",
    },
  },
]);

function obsidianSourceRecommendedConfig(config) {
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
