import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const sourceTypeScriptFiles = ["src/**/*.{ts,tsx}"];
const strictTypeCheckedTypeScriptRules = Object.assign({}, ...tseslint.configs.strictTypeChecked.map((config) => config.rules ?? {}));

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
  {
    files: sourceTypeScriptFiles,
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
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
      ...strictTypeCheckedTypeScriptRules,
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: sourceTypeScriptFiles,
    plugins: {
      obsidianmd,
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          acronyms: ["MCP"],
          brands: ["Codex", "Codex Panel", "Obsidian"],
        },
      ],
    },
  },
]);

function obsidianRecommendedConfig(config) {
  const rules = Object.fromEntries(Object.entries(config.rules ?? {}).filter(([ruleName]) => ruleName.startsWith("obsidianmd/")));
  if (Object.keys(rules).length === 0) return null;
  const obsidianConfig = {
    basePath: "src",
    rules,
  };
  if (config.files) obsidianConfig.files = config.files;
  if (config.ignores) obsidianConfig.ignores = config.ignores;
  return obsidianConfig;
}
