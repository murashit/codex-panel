import ts from "typescript";

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

export default codexPanelEslintPlugin;
