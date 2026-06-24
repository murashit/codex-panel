import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import codexPanelEslintPlugin from "./scripts/lint/eslint-plugin-codex-panel.mjs";

const typeScriptFiles = ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"];
const nodeJavaScriptFiles = ["*.mjs", "scripts/**/*.mjs", "tests/**/*.mjs"];
const typeScriptConfigFiles = ["*.config.ts"];
const lintedTypeScriptFiles = [...typeScriptFiles, ...typeScriptConfigFiles];
const unsafeAnyTypeScriptRules = {
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
};
const chatExternalDomBridgeFiles = [
  "src/features/chat/ui/message-stream/markdown-renderer.ts",
  "src/features/chat/ui/message-stream/stream-markdown-renderer.ts",
  "src/features/chat/ui/message-stream/flow-scroll.ts",
];
const chatPreactDomBridgeFiles = [
  "src/features/chat/ui/message-stream/text-content.tsx",
  "src/features/chat/ui/message-stream/detail.tsx",
  "src/features/chat/ui/message-stream/viewport.tsx",
  "src/features/chat/ui/composer-dom.ts",
  "src/features/chat/panel/shell.tsx",
  "src/features/chat/ui/turn-diff/render.tsx",
];
const chatImperativeDomBridgeFiles = [...chatExternalDomBridgeFiles, ...chatPreactDomBridgeFiles];
const nonChatImperativeDomBridgeFiles = [
  "src/features/selection-rewrite/popover.tsx",
  "src/features/thread-picker/modal.ts",
  "src/features/threads-view/renderer.tsx",
  "src/settings/tab.tsx",
  "src/shared/diff/render.ts",
  "src/shared/ui/components.tsx",
  "src/shared/ui/textarea-autogrow.ts",
  "src/shared/ui/textarea-caret.ts",
  "src/shared/ui/ui-root.tsx",
];
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
    files: lintedTypeScriptFiles,
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
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
      ...unsafeAnyTypeScriptRules,
    },
  },
  {
    files: nodeJavaScriptFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        URL: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    plugins: {
      "codex-panel": codexPanelEslintPlugin,
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
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/features/chat/**/*.{ts,tsx}", ...nonChatImperativeDomBridgeFiles],
    rules: {
      "codex-panel/no-imperative-dom": "error",
    },
  },
  {
    files: ["src/features/chat/**/*.{ts,tsx}"],
    ignores: ["src/features/chat/panel/shell-state.tsx", ...chatImperativeDomBridgeFiles],
    rules: {
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: ["src/features/chat/panel/shell-state.tsx"],
    rules: {
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: chatImperativeDomBridgeFiles,
    rules: {
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
]);
