/**
 * Generates the browser-side LML runtime (lml-runtime.js) and the SPA shell
 * HTML page (index.html) used when deploying an LML project as a single-page
 * application.
 *
 * The runtime:
 *   1. Reads the current URL pathname and fetches the corresponding .lml file.
 *   2. Parses the LML source using a browser port of the same parser logic.
 *   3. Renders the AST to an HTML string and sets it as innerHTML of the outlet.
 *   4. Intercepts same-origin <a> clicks and uses history.pushState so the
 *      browser never does a full page reload after the initial shell load.
 *
 * Server-side only two things need to be configured:
 *   - .lml files must be served as static files (text/plain).
 *   - Everything else must fall through to index.html (standard SPA catch-all).
 */
export interface ShellOptions {
    /** Text shown in the browser tab before the first page loads. Default: 'LML App'. */
    title?: string;
    /** Value of the <html lang=""> attribute. Default: 'en'. */
    lang?: string;
    /** Raw HTML injected at the end of <head> (link tags, meta, etc.). */
    headExtra?: string;
}
/**
 * Returns the single static index.html that acts as the SPA entry point.
 * It renders a bare page with an #lml-app outlet and loads lml-runtime.js.
 */
export declare function generateShellHtml(options?: ShellOptions): string;
/**
 * Returns the complete lml-runtime.js source as a string.
 *
 * String.raw is used so that backslash sequences inside the JS (regex
 * character classes like \s, \S, \t, etc.) are preserved verbatim rather
 * than being interpreted as TypeScript escape sequences.
 *
 * The runtime itself deliberately avoids template literals so that no ${…}
 * sequences appear inside the String.raw template, which would otherwise be
 * evaluated as TypeScript interpolations.
 */
export declare function generateBrowserRuntime(): string;
//# sourceMappingURL=runtime.d.ts.map