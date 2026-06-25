import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import ts from "typescript";
import tseslint from "typescript-eslint";

const sourceTypeScriptFiles = ["src/**/*.{ts,tsx}"];
const strictTypeCheckedTypeScriptRules = Object.assign({}, ...tseslint.configs.strictTypeChecked.map((config) => config.rules ?? {}));
// This local rule needs TypeScript type information. Keep it validated by
// eslint over real source files instead of synthetic Vitest fixtures, which
// would start the TypeScript project service during the test suite.
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
const imperativeDomWriteMethods = new Set([
  "addClass",
  "addClasses",
  "append",
  "appendChild",
  "after",
  "before",
  "createDiv",
  "createEl",
  "createSpan",
  "empty",
  "hide",
  "insertAdjacentElement",
  "insertAdjacentHTML",
  "insertAdjacentText",
  "insertBefore",
  "prepend",
  "removeClass",
  "removeClasses",
  "remove",
  "removeChild",
  "replaceChildren",
  "replaceWith",
  "setCssProps",
  "setCssStyles",
  "setText",
  "show",
  "setAttr",
  "toggleClass",
]);
const imperativeDomEventMethods = new Set(["addEventListener", "removeEventListener"]);
const imperativeDomAssignmentProperties = new Set([
  "checked",
  "innerHTML",
  "onblur",
  "onchange",
  "onclick",
  "ondblclick",
  "onfocus",
  "oninput",
  "onkeydown",
  "onkeyup",
  "onmousedown",
  "onmousemove",
  "onmouseup",
  "onpointerdown",
  "onpointerup",
  "onscroll",
  "onselect",
  "outerHTML",
  "textContent",
  "value",
]);

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
      "codex-panel": codexPanelEslintPlugin(),
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
    files: sourceTypeScriptFiles,
    ignores: ["src/features/chat/**/*.{ts,tsx}", ...nonChatImperativeDomBridgeFiles],
    rules: {
      "codex-panel/no-imperative-dom": "error",
    },
  },
  {
    files: ["src/features/chat/**/*.{ts,tsx}"],
    ignores: chatImperativeDomBridgeFiles,
    rules: {
      "codex-panel/no-imperative-dom": "error",
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

function codexPanelEslintPlugin() {
  return {
    rules: {
      "no-imperative-dom": imperativeDomRule(),
    },
  };
}

function imperativeDomRule() {
  return {
    meta: {
      type: "problem",
      docs: {
        description: "Disallow imperative DOM writes and event wiring outside explicit bridge files.",
      },
      messages: {
        event: "Keep imperative DOM event wiring in an explicit bridge module or Obsidian-owned UI boundary.",
        write: "Keep imperative DOM writes in an explicit bridge module or Obsidian-owned UI boundary.",
      },
      schema: [],
    },
    create(context) {
      const typed = typedContext(context);
      const isDomTarget = (node) => typeIncludesDom(typed.typeAt(node), typed.typeChecker());

      return {
        AssignmentExpression(node) {
          if (!isMemberExpression(node.left)) return;
          const property = staticPropertyName(node.left.property);
          if (!property || !imperativeDomAssignmentProperties.has(property)) return;
          if (isDomTarget(node.left.object)) context.report({ node: node.left, messageId: "write" });
        },
        CallExpression(node) {
          if (!isMemberExpression(node.callee)) return;
          const method = staticPropertyName(node.callee.property);
          if (!method) return;
          if (imperativeDomWriteMethods.has(method) && isDomTarget(node.callee.object)) {
            context.report({ node: node.callee, messageId: "write" });
            return;
          }
          if (imperativeDomEventMethods.has(method) && isDomTarget(node.callee.object)) {
            context.report({ node: node.callee, messageId: "event" });
          }
        },
      };
    },
  };
}

function typedContext(context) {
  let parserServices = null;
  let checker = null;

  const services = () => {
    if (!parserServices) {
      parserServices = parserServicesFromContext(context);
      checker = parserServices.program.getTypeChecker();
    }
    return parserServices;
  };
  const typeChecker = () => {
    services();
    return checker;
  };

  return {
    typeChecker,
    typeAt(node) {
      const tsNode = services().esTreeNodeToTSNodeMap.get(node);
      return typeChecker().getTypeAtLocation(tsNode);
    },
  };
}

function isMemberExpression(node) {
  return node?.type === "MemberExpression";
}

function staticPropertyName(node) {
  return node?.type === "Identifier" ? node.name : node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function parserServicesFromContext(context) {
  const services = context.sourceCode.parserServices;
  if (!services?.program || !services.esTreeNodeToTSNodeMap) {
    throw new Error("codex-panel typed ESLint rules require TypeScript parser services.");
  }
  return services;
}

function typeIncludesDom(type, checker, seen = new Set()) {
  if (!type || seen.has(type.id)) return false;
  seen.add(type.id);

  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
  if (type.isUnionOrIntersection()) return type.types.some((item) => typeIncludesDom(item, checker, seen));

  const typeName = checker.typeToString(type);
  if (domTypeName(typeName)) return true;

  const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName() ?? "";
  if (domTypeName(symbolName)) return true;

  const apparent = checker.getApparentType(type);
  if (apparent !== type && typeIncludesDom(apparent, checker, seen)) return true;

  const bases = typeof type.getBaseTypes === "function" ? (type.getBaseTypes() ?? []) : [];
  return bases.some((base) => typeIncludesDom(base, checker, seen));
}

function domTypeName(name) {
  return /\b(?:Document|Element|HTML[A-Za-z]*Element|HTMLElement|Node|SVG[A-Za-z]*Element|SVGElement|Window)\b/.test(name);
}
