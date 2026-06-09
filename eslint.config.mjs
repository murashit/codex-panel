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
const unsafeIteratorRestrictions = [
  {
    selector: "MemberExpression[property.name='value'][object.type='CallExpression'][object.callee.property.name='next']",
    message: "Avoid reading iterator.next().value directly; use for...of or inspect the typed IteratorResult first.",
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
  "src/features/chat/ui/message-stream/**/*.{ts,tsx}",
  "src/features/chat/ui/composer.tsx",
  "src/features/chat/ui/goal-banner.tsx",
  "src/features/chat/ui/scroll.ts",
  "src/features/chat/ui/shell.tsx",
  "src/features/chat/ui/tool-result.tsx",
  "src/features/chat/ui/turn-diff.tsx",
];
const nonChatImperativeDomBridgeFiles = [
  "src/app-server/structured-ephemeral-turn.ts",
  "src/features/selection-rewrite/popover.tsx",
  "src/features/selection-rewrite/runner.ts",
  "src/features/thread-picker/modal.ts",
  "src/settings/dynamic-sections.ts",
  "src/settings/tab.ts",
  "src/shared/diff/render.ts",
  "src/shared/ui/dom.ts",
  "src/shared/ui/components.tsx",
  "src/shared/ui/textarea-autogrow.ts",
  "src/shared/ui/textarea-caret.ts",
  "src/shared/ui/ui-root.tsx",
];
const codexPanelEslintPlugin = {
  rules: {
    "no-self-referential-initializer-callback": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow callbacks in variable initializers from referencing the variable being initialized.",
        },
        messages: {
          selfReference: "Avoid referencing '{{name}}' from a callback inside its own initializer; declare it first with an explicit type.",
        },
        schema: [],
      },
      create(context) {
        return {
          VariableDeclarator(node) {
            if (node.id.type !== "Identifier" || !node.init) return;
            if (node.init.type !== "NewExpression") return;
            const reference = findInitializerCallbackReference(node.init, node.id.name);
            if (reference) context.report({ node: reference, messageId: "selfReference", data: { name: node.id.name } });
          },
        };
      },
    },
    "no-chat-state-direct-mutation": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow direct ChatState mutation in chat modules.",
        },
        messages: {
          assign: "Route ChatState updates through ChatStateStore.dispatch().",
          mutateCollection: "Clone ChatState collections and update them through ChatStateStore.dispatch().",
        },
        schema: [],
      },
      create(context) {
        const mutatingCollectionMethods = new Set(["add", "clear", "delete", "push", "set"]);
        return {
          AssignmentExpression(node) {
            if (isChatStateMember(node.left)) context.report({ node: node.left, messageId: "assign" });
          },
          CallExpression(node) {
            if (!isMemberExpression(node.callee)) return;
            const method = staticPropertyName(node.callee.property);
            if (!method || !mutatingCollectionMethods.has(method)) return;
            if (isChatStateMember(node.callee.object)) context.report({ node: node.callee, messageId: "mutateCollection" });
          },
        };
      },
    },
  },
};

function isChatStateMember(node) {
  if (!isMemberExpression(node)) return false;

  let current = node;
  while (isMemberExpression(current)) {
    if (isIdentifier(current.object, "state")) return true;
    if (isThisStateMember(current.object)) return true;
    current = current.object;
  }
  return false;
}

function isThisStateMember(node) {
  return isMemberExpression(node) && node.object?.type === "ThisExpression" && staticPropertyName(node.property) === "state";
}

function isMemberExpression(node) {
  return node?.type === "MemberExpression";
}

function isIdentifier(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

function staticPropertyName(node) {
  return node?.type === "Identifier" ? node.name : node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function findInitializerCallbackReference(root, name) {
  let reference = null;

  const visit = (node, inCallback) => {
    if (!node || reference) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, inCallback);
      return;
    }
    if (typeof node !== "object" || typeof node.type !== "string") return;

    if (isFunctionNode(node)) {
      if (functionShadowsName(node, name)) return;
      visit(node.body, true);
      return;
    }

    if (inCallback && node.type === "Identifier" && node.name === name) {
      reference = node;
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "parent") continue;
      if (node.type === "MemberExpression" && key === "property" && !node.computed) continue;
      if (node.type === "Property" && key === "key" && !node.computed) continue;
      visit(value, inCallback);
    }
  };

  visit(root, false);
  return reference;
}

function isFunctionNode(node) {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function functionShadowsName(node, name) {
  return node.params.some((param) => patternContainsName(param, name)) || patternContainsName(node.id, name);
}

function patternContainsName(node, name) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((item) => patternContainsName(item, name));
  if (typeof node !== "object" || typeof node.type !== "string") return false;
  if (node.type === "Identifier") return node.name === name;
  return Object.entries(node).some(([key, value]) => key !== "parent" && patternContainsName(value, name));
}

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
      "codex-panel": codexPanelEslintPlugin,
      obsidianmd,
    },
    rules: {
      "codex-panel/no-self-referential-initializer-callback": "error",
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
        ...unsafeIteratorRestrictions,
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
        ...unsafeIteratorRestrictions,
        ...imperativeDomRestrictions,
        ...preactFormRestrictions,
      ],
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: chatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...removedChatStateEscapeHatchRestrictions,
        ...unsafeIteratorRestrictions,
        ...preactFormRestrictions,
      ],
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: nonChatImperativeDomBridgeFiles,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...removedChatStateEscapeHatchRestrictions,
        ...unsafeIteratorRestrictions,
        ...preactFormRestrictions,
      ],
    },
  },
  {
    files: ["src/features/chat/chat-state.ts", "src/features/chat/display/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...removedChatStateEscapeHatchRestrictions,
        ...unsafeIteratorRestrictions,
        ...imperativeDomRestrictions,
        ...preactFormRestrictions,
        ...pureChatModelRestrictions,
      ],
      "codex-panel/no-chat-state-direct-mutation": "error",
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
