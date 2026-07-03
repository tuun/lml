import type { Document } from './types.js';
export declare class ParseError extends Error {
    readonly line: number;
    constructor(message: string, line: number);
}
/**
 * Parses LML source text and returns the document AST.
 * Throws `ParseError` on any syntax problem.
 */
export declare function parse(source: string): Document;
/**
 * Splits an LML source file that begins with a JS script section into its two
 * parts.  The separator is a line whose trimmed content is exactly <lml>.
 *
 * Everything before <lml> is the body of an async function whose declared
 * variables become the template context.  Everything after is LML markup and
 * may contain one or more adjacent root elements.
 *
 * If no <lml> separator is found the whole source is treated as LML
 * (backwards compatible with files that have no script section).
 */
export declare function splitScriptAndLml(source: string): {
    script: string;
    lml: string;
};
//# sourceMappingURL=parser.d.ts.map