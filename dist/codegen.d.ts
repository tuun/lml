import type { Document } from './types.js';
export interface EmitOptions {
    /**
     * Emit pretty-printed output (indented).
     * @default true
     */
    pretty?: boolean;
    /**
     * Prepend `<!DOCTYPE html>` when the first root element is `<html>`.
     * @default true
     */
    doctype?: boolean;
}
/**
 * Callback used by `resolveDocument` to load a template (`_t/`) or partial
 * (`_p/`) document. Receives the relative path (e.g. `_t/base.lml`) and
 * returns the parsed Document, or `null` if the file cannot be found.
 */
export type DocumentReader = (path: string) => Document | null;
/**
 * Resolves all `<t.*>` template and `<p.*>` partial references in `doc`,
 * returning a new Document with each such node replaced by its expanded
 * content.  Loaded files are read via `reader`.  Throws if a referenced
 * template or partial cannot be found.
 */
export declare function resolveDocument(doc: Document, reader: DocumentReader, initialVars?: Record<string, unknown>): Document;
/**
 * Executes the script section of an LML file (the code before `return`)
 * as an async function in Node.js and returns the resolved variable values.
 * Any Promise values are automatically awaited so callers can use either
 * `const x = await fetch(...)` or `const x = fetch(...).then(...)`.
 */
export declare function execScriptSection(script: string): Promise<Record<string, unknown>>;
/**
 * Converts a parsed LML Document AST into an HTML string.
 */
export declare function emit(document: Document, options?: EmitOptions): string;
/**
 * Reader function for the JS compiler. Returns the script section and parsed
 * LML nodes for a template/partial path (e.g. '_t/card.lml'), or null if the
 * file does not exist. The caller is responsible for splitting and parsing.
 */
export type JsCompiledReader = (path: string) => {
    script: string;
    nodes: Document;
} | null;
/**
 * Compiles a pre-parsed LML page to a self-contained ES module.
 *
 * The caller must split the source and parse the LML section before calling:
 *   const { script, lml } = splitScriptAndLml(source);
 *   const nodes = parse(lml);
 *   const js = compilePageToJs({ script, nodes }, reader);
 *
 * Templates and partials are resolved at compile time via `reader`.
 * The generated module exports a default async function that returns
 * { title, headNodes, html } — the same shape that the browser render()
 * function consumes. No eval, new Function, or unsafe-eval is needed at
 * runtime; the browser loads the compiled module with import().
 */
export declare function compilePageToJs(page: {
    script: string;
    nodes: Document;
}, reader: JsCompiledReader): string;
//# sourceMappingURL=codegen.d.ts.map