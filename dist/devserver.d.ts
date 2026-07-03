/**
 * LML local development server.
 *
 * Serves an LML project directory exactly as it would appear in production:
 *   - *.lml.js requests are compiled on-the-fly from the corresponding *.lml source
 *   - lml-runtime.js is served from memory (always up-to-date)
 *   - index.html shell is served from memory for every non-file route
 *   - Other static assets (CSS, images, fonts) are served from the src dir
 *   - File changes trigger a live reload via Server-Sent Events (no deps)
 */
import { type ShellOptions } from './runtime.js';
export interface DevServerOptions extends ShellOptions {
    /** Port to listen on. Default: 3000. */
    port?: number;
    /** Hostname/IP to bind to. Default: '127.0.0.1' (loopback only). Pass '0.0.0.0' to expose on the network. */
    host?: string;
    /** Enable live reload via SSE. Default: true. */
    liveReload?: boolean;
    /** Maximum concurrent SSE (live-reload) connections. Default: 50. */
    maxSseClients?: number;
}
/**
 * Starts the LML development server. Blocks until the process is killed.
 *
 * The server mirrors production SPA behaviour:
 *   - Real files (including .lml) are served from `srcDir`.
 *   - lml-runtime.js is generated in memory from the installed version of lmlc.
 *   - Everything else falls through to the in-memory index.html shell.
 *
 * When live reload is enabled (default) a small SSE script is injected into
 * the shell. Any .lml file change in srcDir triggers an instant page reload.
 */
export declare function startDevServer(srcDir: string, options?: DevServerOptions): void;
//# sourceMappingURL=devserver.d.ts.map