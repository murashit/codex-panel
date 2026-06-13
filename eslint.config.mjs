import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import obsidianmd from "eslint-plugin-obsidianmd";
import reactHooks from "eslint-plugin-react-hooks";
import ts from "typescript";
import tseslint from "typescript-eslint";

const typeScriptFiles = ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"];
const nodeJavaScriptFiles = ["*.mjs", "scripts/**/*.mjs"];
const typeScriptConfigFiles = ["*.config.ts"];
const lintedTypeScriptFiles = [...typeScriptFiles, ...typeScriptConfigFiles];
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
const generatedAppServerSourceImportPatterns = importBoundaryPatterns("generated/app-server", "src/generated/app-server", 6);
const generatedAppServerTestImportPatterns = importBoundaryPatterns("src/generated/app-server", "src/generated/app-server", 6);
const lowerLevelFeatureImportPatterns = importBoundaryPatterns("features", "src/features", 6);
const featureBannedAppServerProtocolModules = [
  "catalog",
  "diagnostics",
  "initialization",
  "request-input",
  "runtime-config",
  "runtime-metrics",
  "runtime-policy",
  "thread",
  "thread-goal",
  "thread-settings",
  "turn-history",
];
const featureBannedAppServerProtocolImportPatterns = featureBannedAppServerProtocolModules.flatMap((moduleName) =>
  importBoundaryPatterns(`app-server/protocol/${moduleName}`, `src/app-server/protocol/${moduleName}`, 6),
);
const generatedAppServerThreadImportRestrictions = [
  {
    selector:
      "ImportDeclaration[source.value=/generated\\/app-server\\/v2\\/Thread$/] ImportSpecifier[imported.name='Thread'][local.name='Thread']",
    message: "Import generated app-server Thread as AppServerThread, or use the Panel-owned domain Thread model.",
  },
];
const unsafeIteratorRestrictions = [
  {
    selector: "MemberExpression[property.name='value'][object.type='CallExpression'][object.callee.property.name='next']",
    message: "Avoid reading iterator.next().value directly; use for...of or inspect the typed IteratorResult first.",
  },
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
const chatExternalDomBridgeFiles = [
  "src/features/chat/ui/message-stream/markdown-renderer.ts",
  "src/features/chat/ui/message-stream/virtualizer.ts",
];
const chatPreactDomBridgeFiles = [
  "src/features/chat/ui/goal.tsx",
  "src/features/chat/ui/message-stream/text-item-actions.tsx",
  "src/features/chat/ui/message-stream/text-item.tsx",
  "src/features/chat/ui/message-stream/tool-result.tsx",
  "src/features/chat/ui/message-stream/viewport.tsx",
  "src/features/chat/ui/composer.tsx",
  "src/features/chat/ui/shell.tsx",
  "src/features/chat/turn-diff/render.tsx",
];
const chatImperativeDomBridgeFiles = [...chatExternalDomBridgeFiles, ...chatPreactDomBridgeFiles];
const nonChatImperativeDomBridgeFiles = [
  "src/features/selection-rewrite/popover.tsx",
  "src/features/thread-picker/modal.ts",
  "src/features/threads-view/renderer.tsx",
  "src/settings/dynamic-sections.ts",
  "src/settings/tab.ts",
  "src/shared/diff/render.ts",
  "src/shared/ui/components.tsx",
  "src/shared/ui/textarea-autogrow.ts",
  "src/shared/ui/textarea-caret.ts",
  "src/shared/ui/ui-root.tsx",
];
const nonUiEventListenerFiles = ["src/shared/lifecycle/abortable.ts"];
const baseSourceSyntaxRestrictions = [
  ...removedChatStateEscapeHatchRestrictions,
  ...generatedAppServerThreadImportRestrictions,
  ...unsafeIteratorRestrictions,
  ...preactFormRestrictions,
];
const sourceSyntaxRestrictions = baseSourceSyntaxRestrictions;
const domBridgeSyntaxRestrictions = baseSourceSyntaxRestrictions;
const pureChatModelSyntaxRestrictions = [...sourceSyntaxRestrictions, ...pureChatModelRestrictions];
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
    "no-imperative-dom": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow imperative DOM writes and event wiring outside explicit bridge files.",
        },
        messages: {
          event: "Keep imperative DOM event wiring in an explicit bridge module or Obsidian-owned UI boundary.",
          write: "Keep imperative DOM writes in an explicit bridge module or Obsidian-owned UI boundary.",
        },
        schema: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              allowEvents: { type: "boolean" },
              allowWrites: { type: "boolean" },
            },
          },
        ],
      },
      create(context) {
        const options = context.options[0] ?? {};
        const allowEvents = options.allowEvents === true;
        const allowWrites = options.allowWrites === true;
        let parserServices = null;
        let checker = null;

        const typeChecker = () => {
          if (!parserServices) {
            parserServices = parserServicesFromContext(context);
            checker = parserServices.program.getTypeChecker();
          }
          return checker;
        };

        const isDomTarget = (node) => {
          const services = parserServices ?? parserServicesFromContext(context);
          if (!parserServices) {
            parserServices = services;
            checker = services.program.getTypeChecker();
          }
          const tsNode = services.esTreeNodeToTSNodeMap.get(node);
          return typeIncludesDom(typeChecker().getTypeAtLocation(tsNode), typeChecker());
        };

        return {
          AssignmentExpression(node) {
            if (allowWrites || !isMemberExpression(node.left)) return;
            const property = staticPropertyName(node.left.property);
            if (!property || !imperativeDomAssignmentProperties.has(property)) return;
            if (isDomTarget(node.left.object)) context.report({ node: node.left, messageId: "write" });
          },
          CallExpression(node) {
            if (!isMemberExpression(node.callee)) return;
            const method = staticPropertyName(node.callee.property);
            if (!method) return;
            if (!allowWrites && imperativeDomWriteMethods.has(method) && isDomTarget(node.callee.object)) {
              context.report({ node: node.callee, messageId: "write" });
              return;
            }
            if (!allowEvents && imperativeDomEventMethods.has(method) && isDomTarget(node.callee.object)) {
              context.report({ node: node.callee, messageId: "event" });
            }
          },
        };
      },
    },
  },
};

function importBoundaryPatterns(relativeTarget, absoluteTarget, maxParentDepth) {
  const targets = [absoluteTarget, ...Array.from({ length: maxParentDepth }, (_, index) => `${"../".repeat(index + 1)}${relativeTarget}`)];
  return targets.flatMap((target) => [target, `${target}/**`]);
}

function restrictedSyntaxRule(restrictions) {
  return {
    "no-restricted-syntax": ["error", ...restrictions],
  };
}

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

function parserServicesFromContext(context) {
  const services = context.sourceCode.parserServices;
  if (!services?.program || !services.esTreeNodeToTSNodeMap) {
    throw new Error("codex-panel/no-imperative-dom requires TypeScript parser services.");
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
  return /\b(?:AbortSignal|Document|Element|EventTarget|HTML[A-Za-z]*Element|HTMLElement|Node|SVG[A-Za-z]*Element|SVGElement|Window)\b/.test(
    name,
  );
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
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
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
      ...restrictedSyntaxRule(generatedAppServerThreadImportRestrictions),
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
    ignores: ["src/features/chat/**/*.{ts,tsx}", ...nonChatImperativeDomBridgeFiles, ...nonUiEventListenerFiles],
    rules: {
      ...restrictedSyntaxRule(sourceSyntaxRestrictions),
      "codex-panel/no-imperative-dom": "error",
    },
  },
  {
    files: ["src/features/chat/**/*.{ts,tsx}"],
    ignores: chatImperativeDomBridgeFiles,
    rules: {
      ...restrictedSyntaxRule(sourceSyntaxRestrictions),
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: chatImperativeDomBridgeFiles,
    rules: {
      ...restrictedSyntaxRule(domBridgeSyntaxRestrictions),
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: nonChatImperativeDomBridgeFiles,
    rules: restrictedSyntaxRule(domBridgeSyntaxRestrictions),
  },
  {
    files: nonUiEventListenerFiles,
    rules: {
      ...restrictedSyntaxRule(sourceSyntaxRestrictions),
      "codex-panel/no-imperative-dom": ["error", { allowEvents: true }],
    },
  },
  {
    files: ["src/features/chat/state/**/*.{ts,tsx}", "src/features/chat/display/**/*.{ts,tsx}"],
    rules: {
      ...restrictedSyntaxRule(pureChatModelSyntaxRestrictions),
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: ["src/app-server/**/*.{ts,tsx}", "src/domain/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: lowerLevelFeatureImportPatterns,
              message: "Lower-level modules must not import feature modules. Move shared behavior to shared, domain, or app-server.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: featureBannedAppServerProtocolImportPatterns,
              message:
                "Feature modules must use domain models and app-server services instead of app-server protocol modules. The turn display/history protocol remains the only feature-side exception.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app-server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: generatedAppServerSourceImportPatterns,
              message: "Keep generated app-server types behind src/app-server; expose Panel-owned models to feature, UI, and reducer code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    ignores: ["tests/app-server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: generatedAppServerTestImportPatterns,
              message:
                "Keep generated app-server types behind src/app-server and tests/app-server; feature tests should use Panel-owned models.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
]);
