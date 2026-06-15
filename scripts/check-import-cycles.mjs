import path from "node:path";
import ts from "typescript";

if (process.argv.length > 2) {
  console.error("Usage: node scripts/check-import-cycles.mjs");
  process.exit(1);
}

const cwd = process.cwd();
const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
if (!configPath) {
  console.error("Could not find tsconfig.json.");
  process.exit(1);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  reportDiagnostic(configFile.error);
  process.exit(1);
}

const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
if (parsedConfig.errors.length > 0) {
  for (const diagnostic of parsedConfig.errors) reportDiagnostic(diagnostic);
  process.exit(1);
}

const sourceFiles = parsedConfig.fileNames.map((file) => path.resolve(file)).filter((file) => isCheckedSourceFile(relativePath(file)));
const sourceFileSet = new Set(sourceFiles);
const compilerHost = ts.createCompilerHost(parsedConfig.options, true);
const moduleResolutionCache = ts.createModuleResolutionCache(cwd, (file) => file, parsedConfig.options);
const graph = new Map(sourceFiles.map((file) => [relativePath(file), new Set()]));

for (const sourceFile of sourceFiles) {
  const sourceText = ts.sys.readFile(sourceFile);
  if (sourceText === undefined) continue;

  const parsedSource = ts.createSourceFile(sourceFile, sourceText, parsedConfig.options.target ?? ts.ScriptTarget.ES2022, true);
  const from = relativePath(sourceFile);

  for (const edge of importEdges(parsedSource)) {
    const resolved = ts.resolveModuleName(
      edge.specifier,
      sourceFile,
      parsedConfig.options,
      compilerHost,
      moduleResolutionCache,
    ).resolvedModule;
    if (!resolved) continue;

    const resolvedFile = path.resolve(resolved.resolvedFileName);
    if (!sourceFileSet.has(resolvedFile)) continue;

    graph.get(from)?.add(relativePath(resolvedFile));
  }
}

const cycleComponents = stronglyConnectedComponents(graph)
  .filter((component) => component.length > 1 || hasSelfDependency(graph, component[0]))
  .sort((left, right) => left[0].localeCompare(right[0]));

if (cycleComponents.length === 0) {
  console.log("No import cycles found.");
  process.exit(0);
}

console.error(`Import cycle check failed: found ${cycleComponents.length} cycle${cycleComponents.length === 1 ? "" : "s"}.`);
for (const [index, component] of cycleComponents.entries()) {
  const cycle = sampleCycle(graph, component);
  console.error(`${index + 1}. ${cycle.join(" -> ")}`);
}
process.exit(1);

function importEdges(sourceFile) {
  const edges = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && hasRuntimeImportEdge(statement) && stringLiteralText(statement.moduleSpecifier)) {
      edges.push({
        specifier: stringLiteralText(statement.moduleSpecifier),
      });
    } else if (
      ts.isExportDeclaration(statement) &&
      hasRuntimeExportEdge(statement) &&
      statement.moduleSpecifier &&
      stringLiteralText(statement.moduleSpecifier)
    ) {
      edges.push({
        specifier: stringLiteralText(statement.moduleSpecifier),
      });
    }
  }

  return edges;
}

function hasRuntimeImportEdge(statement) {
  const importClause = statement.importClause;
  if (!importClause) return true;
  if (importClause.isTypeOnly) return false;
  if (importClause.name) return true;

  const namedBindings = importClause.namedBindings;
  if (!namedBindings) return false;
  if (ts.isNamespaceImport(namedBindings)) return true;
  return namedBindings.elements.some((element) => !element.isTypeOnly);
}

function hasRuntimeExportEdge(statement) {
  if (statement.isTypeOnly) return false;

  const exportClause = statement.exportClause;
  if (!exportClause) return true;
  if (ts.isNamespaceExport(exportClause)) return true;
  return exportClause.elements.some((element) => !element.isTypeOnly);
}

function stringLiteralText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function stronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowLinks = new Map();
  const components = [];

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }

  return components.map((component) => component.sort());

  function visit(node) {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(dependency)));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;

    const component = [];
    let item;
    do {
      item = stack.pop();
      onStack.delete(item);
      component.push(item);
    } while (item !== node);
    components.push(component);
  }
}

function sampleCycle(graph, component) {
  const componentSet = new Set(component);

  for (const start of component) {
    if (graph.get(start)?.has(start)) return [start, start];

    for (const dependency of graph.get(start) ?? []) {
      if (!componentSet.has(dependency)) continue;
      const pathToStart = findPath(graph, componentSet, dependency, start, new Set([start]));
      if (pathToStart) return [start, ...pathToStart];
    }
  }

  return component;
}

function findPath(graph, allowedNodes, current, target, seen) {
  if (current === target) return [current];
  if (seen.has(current)) return null;
  seen.add(current);

  for (const dependency of graph.get(current) ?? []) {
    if (!allowedNodes.has(dependency)) continue;
    const path = findPath(graph, allowedNodes, dependency, target, seen);
    if (path) return [current, ...path];
  }

  return null;
}

function hasSelfDependency(graph, node) {
  return Boolean(node && graph.get(node)?.has(node));
}

function isCheckedSourceFile(file) {
  return (
    file.startsWith("src/") &&
    !file.startsWith("src/generated/") &&
    (file.endsWith(".ts") || file.endsWith(".tsx")) &&
    !file.endsWith(".d.ts")
  );
}

function relativePath(file) {
  return path.relative(cwd, file).split(path.sep).join("/");
}

function reportDiagnostic(diagnostic) {
  console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}
