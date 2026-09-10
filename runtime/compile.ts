import ts from 'typescript';
import { readPackage } from './package';

export function compileProgram(source: string, name = 'My Orbit') {
  if (source.length > 100_000) throw new Error('Program is larger than 100 KB.');
  const tree = ts.createSourceFile('orbit.ts', source, ts.ScriptTarget.ES2022, true);
  const modules = new Set(['@orbit/sdk', '@orbit/familiar', '@orbit/sdk/runtime']);
  function inspect(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !modules.has(node.moduleSpecifier.text)) throw new Error('Orbit packages currently support @orbit/sdk, @orbit/familiar and @orbit/sdk/runtime imports.');
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error('Dynamic imports are not supported in Orbit packages.');
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: false }, reportDiagnostics: true });
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors?.length) throw new Error(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  return readPackage({ version: 1, name, source, code: result.outputText });
}
