import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import obsidianmd from "eslint-plugin-obsidianmd";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const typeScriptFiles = ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"];
const nodeJavaScriptFiles = ["*.mjs", "scripts/**/*.mjs"];
const typeScriptConfigFiles = ["*.config.ts"];
const lintedTypeScriptFiles = [...typeScriptFiles, ...typeScriptConfigFiles];
const imperativeDomRestrictions = [
  {
    selector:
      "CallExpression[callee.property.name=/^(createEl|createDiv|createSpan|appendChild|replaceChildren|insertBefore|removeChild|append|prepend|before|after|replaceWith|remove|insertAdjacentHTML|insertAdjacentElement|insertAdjacentText|setAttr|empty)$/]",
    message: "Keep imperative DOM writes in an explicit bridge module or Obsidian-owned UI boundary.",
  },
  {
    selector:
      "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML|textContent|value|checked|onclick|ondblclick|oninput|onchange|onkeydown|onkeyup|onmousedown|onmouseup|onmousemove|onpointerdown|onpointerup|onblur|onfocus|onselect|onscroll)$/]",
    message: "Keep imperative DOM writes in an explicit bridge module or Obsidian-owned UI boundary.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(addEventListener|removeEventListener)$/]",
    message: "Keep imperative DOM event wiring in an explicit bridge module or Obsidian-owned UI boundary.",
  },
];
const reactFormRestrictions = [
  {
    selector: "JSXAttribute[name.name=/^(defaultValue|defaultChecked)$/]",
    message: "Keep React form state explicit with controlled value or checked props.",
  },
];
const chatStateRestrictions = [
  {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.object.name='state']",
    message: "Route ChatState updates through ChatStateStore.dispatch().",
  },
  {
    selector: "AssignmentExpression[left.type='MemberExpression'][left.object.type='MemberExpression'][left.object.property.name='state']",
    message: "Route ChatState updates through ChatStateStore.dispatch().",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(push|set|delete|clear|add)$/][callee.object.type='MemberExpression'][callee.object.object.name='state']",
    message: "Clone ChatState collections and update them through ChatStateStore.dispatch().",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(push|set|delete|clear|add)$/][callee.object.type='MemberExpression'][callee.object.object.type='MemberExpression'][callee.object.object.property.name='state']",
    message: "Clone ChatState collections and update them through ChatStateStore.dispatch().",
  },
];
const chatImperativeDomBridgeFiles = [
  "src/features/chat/chat-message-renderer.ts",
  "src/features/chat/markdown-message-renderer.ts",
  "src/features/chat/ui/composer.tsx",
  "src/features/chat/ui/message-stream.tsx",
  "src/features/chat/ui/tool-result.tsx",
  "src/features/chat/ui/turn-diff.tsx",
];
const nonChatImperativeDomBridgeFiles = [
  "src/features/selection-rewrite/popover.tsx",
  "src/features/selection-rewrite/runner.ts",
  "src/features/thread-picker/modal.ts",
  "src/settings/dynamic-sections.ts",
  "src/settings/tab.ts",
  "src/shared/diff/render.ts",
  "src/shared/ui/dom.ts",
  "src/shared/ui/react-components.tsx",
  "src/shared/ui/react-root.tsx",
];

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**", "src/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: lintedTypeScriptFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: lintedTypeScriptFiles,
  })),
  ...obsidianmd.configs.recommended.map((config) => ({
    ...config,
    basePath: "src",
  })),
  {
    files: lintedTypeScriptFiles,
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
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
        console: "readonly",
        document: "readonly",
        requestAnimationFrame: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
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
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
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
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/features/chat/**/*.{ts,tsx}", ...nonChatImperativeDomBridgeFiles],
    rules: {
      "no-restricted-syntax": ["error", ...imperativeDomRestrictions, ...reactFormRestrictions],
    },
  },
  {
    files: ["src/features/chat/**/*.{ts,tsx}"],
    ignores: chatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": ["error", ...imperativeDomRestrictions, ...reactFormRestrictions, ...chatStateRestrictions],
    },
  },
  {
    files: chatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": ["error", ...reactFormRestrictions, ...chatStateRestrictions],
    },
  },
  {
    files: nonChatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": ["error", ...reactFormRestrictions],
    },
  },
  eslintConfigPrettier,
]);
