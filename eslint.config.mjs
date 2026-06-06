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
const preactFormRestrictions = [
  {
    selector: "JSXAttribute[name.name=/^(defaultValue|defaultChecked)$/]",
    message: "Keep Preact form state explicit with controlled value or checked props.",
  },
];
const removedChatStateEscapeHatchRestrictions = [
  {
    selector: "Literal[value='state/patched']",
    message: "Use a named ChatAction instead of reintroducing the generic state patch escape hatch.",
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
const pureChatModelRestrictions = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Keep chat state and display model transforms deterministic; generate IDs or timestamps at the controller/view boundary.",
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: "Keep chat state and display model transforms deterministic; pass dates in from the controller/view boundary.",
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: "Keep chat state and display model transforms deterministic; generate IDs at the controller/view boundary.",
  },
  {
    selector: "NewExpression[callee.name=/^(AppServerClient|ConnectionManager|Notice)$/]",
    message: "Keep app-server and Obsidian side effects out of chat state and display model transforms.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(setTimeout|clearTimeout|requestAnimationFrame)$/]",
    message: "Keep scheduling side effects out of chat state and display model transforms.",
  },
  {
    selector: "MemberExpression[object.name=/^(document|localStorage|sessionStorage)$/]",
    message: "Keep browser globals out of chat state and display model transforms.",
  },
];
const chatImperativeDomBridgeFiles = [
  "src/features/chat/chat-message-renderer.ts",
  "src/features/chat/markdown-message-renderer.ts",
  "src/features/chat/ui/composer.tsx",
  "src/features/chat/ui/goal-banner.tsx",
  "src/features/chat/ui/message-stream.tsx",
  "src/features/chat/ui/scroll.ts",
  "src/features/chat/ui/shell.tsx",
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
  "src/shared/ui/components.tsx",
  "src/shared/ui/textarea-caret.ts",
  "src/shared/ui/ui-root.tsx",
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
      "no-restricted-syntax": [
        "error",
        ...removedChatStateEscapeHatchRestrictions,
        ...imperativeDomRestrictions,
        ...preactFormRestrictions,
      ],
    },
  },
  {
    files: ["src/features/chat/**/*.{ts,tsx}"],
    ignores: chatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...removedChatStateEscapeHatchRestrictions,
        ...imperativeDomRestrictions,
        ...preactFormRestrictions,
        ...chatStateRestrictions,
      ],
    },
  },
  {
    files: chatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": ["error", ...removedChatStateEscapeHatchRestrictions, ...preactFormRestrictions, ...chatStateRestrictions],
    },
  },
  {
    files: nonChatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": ["error", ...removedChatStateEscapeHatchRestrictions, ...preactFormRestrictions],
    },
  },
  {
    files: ["src/features/chat/chat-state.ts", "src/features/chat/display/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...removedChatStateEscapeHatchRestrictions,
        ...imperativeDomRestrictions,
        ...preactFormRestrictions,
        ...chatStateRestrictions,
        ...pureChatModelRestrictions,
      ],
    },
  },
  {
    files: ["src/app-server/**/*.{ts,tsx}", "src/domain/**/*.{ts,tsx}", "src/runtime/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "src/features",
                "src/features/**",
                "../features",
                "../features/**",
                "../../features",
                "../../features/**",
                "../../../features",
                "../../../features/**",
                "../../../../features",
                "../../../../features/**",
              ],
              message:
                "Lower-level modules must not import feature modules. Move shared behavior to shared, domain, runtime, or app-server.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
]);
