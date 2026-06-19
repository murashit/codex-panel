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
const unsafeTypeScriptRules = {
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
};
const projectTypeScriptRules = {
  "@typescript-eslint/consistent-type-imports": "error",
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  ...unsafeTypeScriptRules,
  "react-hooks/exhaustive-deps": "error",
  "react-hooks/rules-of-hooks": "error",
};
const testTypeScriptRelaxations = {
  "@typescript-eslint/no-deprecated": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-unnecessary-type-assertion": "off",
  "@typescript-eslint/require-await": "off",
};
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
const chatSignalAdapterRestrictions = [
  {
    selector: "ImportDeclaration[source.value='@preact/signals']",
    message: "Keep chat signals in panel/shell-state.tsx as a reducer-to-Preact notification adapter.",
  },
];
const chatDomainLayerRestrictions = [
  {
    selector:
      "ImportDeclaration[source.value=/^(?:\\.\\.\\/)+(?:app-server|application|host|panel|presentation|ui)(?:\\/|$)|^src\\/features\\/chat\\/(?:app-server|application|host|panel|presentation|ui)(?:\\/|$)/]",
    message:
      "Keep chat/domain as Panel-owned meaning models and pure derivations; app-server, application, host, panel, presentation, and UI layers may depend on domain, not the reverse.",
  },
];
const uiRootImportRestrictions = [
  {
    selector: "ImportDeclaration[source.value=/shared\\/ui\\/ui-root$/]",
    message: "Import the Preact root adapter only from explicit root bridge files.",
  },
];
const generatedAppServerSourceImportPatterns = importBoundaryPatterns("generated/app-server", "src/generated/app-server", 6);
const generatedAppServerTestImportPatterns = importBoundaryPatterns("src/generated/app-server", "src/generated/app-server", 6);
const lowerLevelFeatureImportPatterns = importBoundaryPatterns("features", "src/features", 6);
const appServerConnectionImportPatterns = importBoundaryPatterns("app-server/connection", "src/app-server/connection", 6);
const appServerProtocolConnectionImportPatterns = [...appServerConnectionImportPatterns, "../connection", "../connection/**"];
const nonAppServerBannedAppServerProtocolModules = [
  "catalog",
  "diagnostics",
  "file-change",
  "initialization",
  "request-input",
  "runtime-config",
  "runtime-metrics",
  "runtime-policy",
  "server-requests",
  "thread",
  "thread-goal",
  "thread-settings",
  "turn",
  "turn-history",
];
const nonAppServerBannedAppServerProtocolImportPatterns = nonAppServerBannedAppServerProtocolModules.flatMap((moduleName) =>
  importBoundaryPatterns(`app-server/protocol/${moduleName}`, `src/app-server/protocol/${moduleName}`, 6),
);
const chatAppServerProtocolBoundaryBannedModules = nonAppServerBannedAppServerProtocolModules.filter((moduleName) => moduleName !== "turn");
const chatAppServerProtocolBoundaryBannedImportPatterns = chatAppServerProtocolBoundaryBannedModules.flatMap((moduleName) =>
  importBoundaryPatterns(`app-server/protocol/${moduleName}`, `src/app-server/protocol/${moduleName}`, 6),
);
const chatAppServerRequestBridgeBannedModules = nonAppServerBannedAppServerProtocolModules.filter(
  (moduleName) => moduleName !== "server-requests",
);
const chatAppServerRequestBridgeBannedImportPatterns = chatAppServerRequestBridgeBannedModules.flatMap((moduleName) =>
  importBoundaryPatterns(`app-server/protocol/${moduleName}`, `src/app-server/protocol/${moduleName}`, 6),
);
const generatedAppServerThreadImportRestrictions = [
  {
    selector:
      "ImportDeclaration[source.value=/generated\\/app-server\\/v2\\/Thread$/] ImportSpecifier[imported.name='Thread'][local.name='Thread']",
    message: "Import generated app-server Thread as AppServerThread, or use the Panel-owned domain Thread model.",
  },
];
const turnProtocolGeneratedImportRestrictions = [
  {
    selector: "ImportDeclaration[source.value=/generated\\/app-server\\//]:not([source.value=/generated\\/app-server\\/v2\\/ThreadItem$/])",
    message: "Only generated ThreadItem is allowed in the turn protocol exception. Model other turn payload shapes locally.",
  },
];
const serverRequestsProtocolGeneratedImportRestrictions = [
  {
    selector:
      "ImportDeclaration[source.value=/generated\\/app-server\\//]:not([source.value=/generated\\/app-server\\/(?:RequestId|ServerRequest)$/])",
    message: "Only generated RequestId and ServerRequest are allowed in the server request protocol exception.",
  },
];
const chatAppServerProtocolBoundaryFiles = [
  "src/features/chat/app-server/inbound/notification-plan.ts",
  "src/features/chat/app-server/mappers/message-stream/turn-items.ts",
];
const chatAppServerRequestBridgeFiles = ["src/features/chat/app-server/requests/**/*.{ts,tsx}"];
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
const pureChatStateRestrictions = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Keep chat state transforms deterministic; generate IDs or timestamps at an application or UI boundary.",
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: "Keep chat state transforms deterministic; pass dates in from an application or UI boundary.",
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: "Keep chat state transforms deterministic; generate IDs at an application or UI boundary.",
  },
  {
    selector: "NewExpression[callee.name=/^(AppServerClient|ConnectionManager|Notice)$/]",
    message: "Keep app-server and Obsidian side effects out of chat state transforms.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(setTimeout|clearTimeout|requestAnimationFrame)$/]",
    message: "Keep scheduling side effects out of chat state transforms.",
  },
  {
    selector: "MemberExpression[object.name=/^(document|localStorage|sessionStorage)$/]",
    message: "Keep browser globals out of chat state transforms.",
  },
];
const chatExternalDomBridgeFiles = [
  "src/features/chat/ui/message-stream/markdown-renderer.ts",
  "src/features/chat/ui/message-stream/stream-markdown-renderer.ts",
  "src/features/chat/ui/message-stream/virtualizer.ts",
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
const uiRootBridgeFiles = [
  "src/features/chat/panel/shell.tsx",
  "src/features/chat/ui/turn-diff/render.tsx",
  "src/features/chat/ui/turn-diff/view.ts",
  "src/features/selection-rewrite/popover.tsx",
  "src/features/threads-view/renderer.tsx",
  "src/settings/tab.tsx",
];
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
const nonUiEventListenerFiles = ["src/shared/lifecycle/abortable.ts", "src/shared/ui/dom-events.ts"];
const appServerProjectionRpcMethodPattern = "^(resumeThread|threadTurnsList|forkThread|rollbackThread)$";
const appServerProjectionRpcRestrictions = [
  {
    selector: `CallExpression[callee.object.name='client'][callee.property.name=/${appServerProjectionRpcMethodPattern}/]`,
    message:
      "Keep app-server projection RPCs behind app-server facades; chat application code should consume Panel-owned snapshots or view models.",
  },
];
const appServerClientProjectionTypeRestrictions = [
  {
    selector: `TSIndexedAccessType[objectType.typeName.name='AppServerClient'][indexType.literal.value=/${appServerProjectionRpcMethodPattern}/]`,
    message:
      "Do not expose app-server projection RPC signatures through AppServerClient indexed access types; define a Panel-owned projection type instead.",
  },
];
const baseSourceSyntaxRestrictions = [
  ...removedChatStateEscapeHatchRestrictions,
  ...generatedAppServerThreadImportRestrictions,
  ...appServerClientProjectionTypeRestrictions,
  ...unsafeIteratorRestrictions,
  ...preactFormRestrictions,
];
const sourceSyntaxRestrictionsWithoutUiRoot = [...baseSourceSyntaxRestrictions, ...chatSignalAdapterRestrictions];
const sourceSyntaxRestrictions = [...sourceSyntaxRestrictionsWithoutUiRoot, ...uiRootImportRestrictions];
const chatSourceSyntaxRestrictions = sourceSyntaxRestrictions;
const chatDomBridgeSyntaxRestrictions = sourceSyntaxRestrictions;
const nonChatDomBridgeSyntaxRestrictions = sourceSyntaxRestrictions;
const pureChatStateSyntaxRestrictions = [...sourceSyntaxRestrictions, ...appServerProjectionRpcRestrictions, ...pureChatStateRestrictions];
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
        const chatStateAliasVariables = new WeakSet();
        let parserServices = null;
        let checker = null;
        const typeChecker = () => {
          if (!parserServices) {
            parserServices = parserServicesFromContext(context);
            checker = parserServices.program.getTypeChecker();
          }
          return checker;
        };
        const variableForIdentifier = (node) => {
          let scope = context.sourceCode.getScope(node);
          while (scope) {
            const variable = scope.variables.find((item) => item.name === node.name);
            if (variable) return variable;
            scope = scope.upper;
          }
          return null;
        };
        const markChatStateAlias = (node) => {
          const variable = variableForIdentifier(node);
          if (variable) chatStateAliasVariables.add(variable);
        };
        const isChatStateAlias = (node) => {
          if (node?.type !== "Identifier") return false;
          const variable = variableForIdentifier(node);
          return Boolean(variable && chatStateAliasVariables.has(variable));
        };
        const typeAt = (node) => {
          const services = parserServices ?? parserServicesFromContext(context);
          if (!parserServices) {
            parserServices = services;
            checker = services.program.getTypeChecker();
          }
          const tsNode = services.esTreeNodeToTSNodeMap.get(node);
          return typeChecker().getTypeAtLocation(tsNode);
        };
        const isChatStateValue = (node) => typeIncludesChatState(typeAt(node), typeChecker());
        const isChatStateAliasSource = (node) =>
          (isChatStateTarget(node) || isChatStateValue(node)) && typeCanCarryChatStateMutation(typeAt(node));
        const isChatStateTarget = (node) => {
          if (isChatStateAlias(node)) return true;
          if (!isMemberExpression(node)) return false;
          if (isChatStateMember(node)) return true;
          const root = rootMemberObject(node);
          if (!root) return false;
          if (isChatStateAlias(root)) return true;
          return typeIncludesChatState(typeAt(root), typeChecker());
        };
        return {
          VariableDeclarator(node) {
            if (node.id.type !== "Identifier" || !node.init) return;
            if (isChatStateAliasSource(node.init)) markChatStateAlias(node.id);
          },
          AssignmentExpression(node) {
            if (isMemberExpression(node.left) && isChatStateTarget(node.left)) context.report({ node: node.left, messageId: "assign" });
          },
          CallExpression(node) {
            if (!isMemberExpression(node.callee)) return;
            const method = staticPropertyName(node.callee.property);
            if (!method || !mutatingCollectionMethods.has(method)) return;
            if (isChatStateTarget(node.callee.object)) context.report({ node: node.callee, messageId: "mutateCollection" });
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

function rootMemberObject(node) {
  if (!isMemberExpression(node)) return null;
  let current = node;
  while (isMemberExpression(current)) current = current.object;
  return current;
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

function typeIncludesChatState(type, checker, seen = new Set()) {
  if (!type || seen.has(type.id)) return false;
  seen.add(type.id);

  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
  if (type.isUnionOrIntersection()) return type.types.some((item) => typeIncludesChatState(item, checker, seen));

  const typeName = checker.typeToString(type);
  if (chatStateTypeName(typeName)) return true;

  const symbolName = type.getSymbol()?.getName() ?? type.aliasSymbol?.getName() ?? "";
  if (chatStateTypeName(symbolName)) return true;

  const apparent = checker.getApparentType(type);
  if (apparent !== type && typeIncludesChatState(apparent, checker, seen)) return true;

  const bases = typeof type.getBaseTypes === "function" ? (type.getBaseTypes() ?? []) : [];
  return bases.some((base) => typeIncludesChatState(base, checker, seen));
}

function typeCanCarryChatStateMutation(type, seen = new Set()) {
  if (!type || seen.has(type.id)) return false;
  seen.add(type.id);

  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
  if (type.isUnionOrIntersection()) return type.types.some((item) => typeCanCarryChatStateMutation(item, seen));

  const primitiveLikeFlags =
    ts.TypeFlags.StringLike |
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.ESSymbolLike |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Void;
  return (type.flags & primitiveLikeFlags) === 0;
}

function domTypeName(name) {
  return /\b(?:AbortSignal|Document|Element|EventTarget|HTML[A-Za-z]*Element|HTMLElement|Node|SVG[A-Za-z]*Element|SVGElement|Window)\b/.test(
    name,
  );
}

function chatStateTypeName(name) {
  return /\bChatState\b/.test(name);
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
      ...projectTypeScriptRules,
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
      ...testTypeScriptRelaxations,
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
    ignores: ["src/features/chat/panel/shell-state.tsx", ...chatImperativeDomBridgeFiles],
    rules: {
      ...restrictedSyntaxRule(chatSourceSyntaxRestrictions),
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: ["src/features/chat/application/**/*.{ts,tsx}"],
    rules: {
      ...restrictedSyntaxRule([...chatSourceSyntaxRestrictions, ...appServerProjectionRpcRestrictions]),
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: ["src/features/chat/panel/shell-state.tsx"],
    rules: {
      ...restrictedSyntaxRule(baseSourceSyntaxRestrictions),
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: chatImperativeDomBridgeFiles,
    rules: {
      ...restrictedSyntaxRule(chatDomBridgeSyntaxRestrictions),
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: nonChatImperativeDomBridgeFiles,
    rules: restrictedSyntaxRule(nonChatDomBridgeSyntaxRestrictions),
  },
  {
    files: nonUiEventListenerFiles,
    rules: {
      ...restrictedSyntaxRule(sourceSyntaxRestrictions),
      "codex-panel/no-imperative-dom": ["error", { allowEvents: true }],
    },
  },
  {
    files: uiRootBridgeFiles,
    rules: restrictedSyntaxRule(sourceSyntaxRestrictionsWithoutUiRoot),
  },
  {
    files: ["src/features/chat/application/state/**/*.{ts,tsx}"],
    rules: {
      ...restrictedSyntaxRule(pureChatStateSyntaxRestrictions),
      "codex-panel/no-imperative-dom": "error",
      "codex-panel/no-chat-state-direct-mutation": "error",
    },
  },
  {
    files: ["src/features/chat/domain/**/*.{ts,tsx}"],
    rules: restrictedSyntaxRule([...sourceSyntaxRestrictions, ...chatDomainLayerRestrictions]),
  },
  {
    files: ["src/app-server/**/*.{ts,tsx}", "src/domain/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: appServerProtocolConnectionImportPatterns,
              message:
                "Keep app-server protocol modules as connection-independent adapters. Put protocol-local projections in protocol modules and let connection/client consume them.",
            },
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
    files: ["src/app-server/**/*.{ts,tsx}"],
    ignores: ["src/app-server/connection/**/*.{ts,tsx}", "src/app-server/protocol/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: generatedAppServerSourceImportPatterns,
              message:
                "Keep generated app-server bindings in the raw connection layer or explicit protocol adapters. App-server services, queries, catalogs, and thread helpers should expose domain models or local projections.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app-server/protocol/**/*.{ts,tsx}"],
    ignores: ["src/app-server/protocol/turn.ts", "src/app-server/protocol/server-requests.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: appServerProtocolConnectionImportPatterns,
              message:
                "Keep app-server protocol modules as connection-independent adapters. Put protocol-local projections in protocol modules and let connection/client consume them.",
            },
            {
              group: lowerLevelFeatureImportPatterns,
              message: "Lower-level modules must not import feature modules. Move shared behavior to shared, domain, or app-server.",
            },
            {
              group: generatedAppServerSourceImportPatterns,
              message:
                "Keep generated app-server bindings out of protocol modules except explicit protocol adapter exceptions. Model app-server payloads with protocol-local projections.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app-server/protocol/turn.ts"],
    rules: {
      ...restrictedSyntaxRule(turnProtocolGeneratedImportRestrictions),
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: appServerProtocolConnectionImportPatterns,
              message:
                "Keep app-server protocol modules as connection-independent adapters. Put protocol-local projections in protocol modules and let connection/client consume them.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app-server/protocol/server-requests.ts"],
    rules: {
      ...restrictedSyntaxRule(serverRequestsProtocolGeneratedImportRestrictions),
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: appServerProtocolConnectionImportPatterns,
              message:
                "Keep app-server protocol modules as connection-independent adapters. Put protocol-local projections in protocol modules and let connection/client consume them.",
            },
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
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app-server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: nonAppServerBannedAppServerProtocolImportPatterns,
              message:
                "Source modules outside app-server must use domain models and app-server services instead of app-server protocol modules. Chat ingestion and message-stream conversion may consume app-server turn protocol at the boundary; feature state and UI must use Panel-owned models.",
            },
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
    files: chatAppServerRequestBridgeFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: chatAppServerRequestBridgeBannedImportPatterns,
              message:
                "Chat request bridges may consume server request protocol projections only. Convert app-server payloads to chat pending request domain models at this boundary.",
            },
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
    files: chatAppServerProtocolBoundaryFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: chatAppServerProtocolBoundaryBannedImportPatterns,
              message:
                "Chat app-server ingestion and message-stream conversion may consume the app-server turn protocol only. Convert other protocol payloads to local or domain models at the boundary.",
            },
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
