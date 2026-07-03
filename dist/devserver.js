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
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, watch } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';
import { generateBrowserRuntime, generateShellHtml } from './runtime.js';
import { fileToUrl } from './server.js';
import { parse, splitScriptAndLml } from './parser.js';
import { compilePageToJs } from './codegen.js';
// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
const MIME = {
    '.lml': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.txt': 'text/plain; charset=utf-8',
};
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
export function startDevServer(srcDir, options = {}) {
    const root = resolve(srcDir);
    const port = options.port ?? 3000;
    const host = options.host ?? '127.0.0.1';
    const liveReload = options.liveReload ?? true;
    const maxSseClients = options.maxSseClients ?? 50;
    // ── Route map ─────────────────────────────────────────────────────────────
    // Walks srcDir to build { url → relFile } used by lml-routes.json endpoint.
    // Rebuilt on every file change so the map stays current during development.
    function buildRouteMap() {
        const map = {};
        const walk = (dir) => {
            let entries;
            try {
                entries = readdirSync(dir);
            }
            catch {
                return;
            }
            for (const entry of entries) {
                const full = join(dir, entry);
                let isDir = false;
                try {
                    isDir = statSync(full).isDirectory();
                }
                catch {
                    continue;
                }
                if (isDir) {
                    if (entry.startsWith('_'))
                        continue; // skip _t, _p, and other special dirs
                    walk(full);
                }
                else if (entry.endsWith('.lml')) {
                    const rel = relative(root, full).replace(/\\/g, '/');
                    // Source workflow: .lml file → route map entry points to compiled .lml.js
                    map[fileToUrl(rel)] = rel + '.js';
                }
                else if (entry.endsWith('.lml.js')) {
                    const rel = relative(root, full).replace(/\\/g, '/');
                    // Dist workflow: precompiled .lml.js — derive URL from the .lml path it
                    // represents (strip .js suffix before passing to fileToUrl).
                    map[fileToUrl(rel.slice(0, -3))] = rel;
                }
            }
        };
        walk(root);
        return map;
    }
    let routeMap = buildRouteMap();
    // ── In-memory assets ─────────────────────────────────────────────────────
    const runtimeJs = generateBrowserRuntime();
    // Dev-only scripts are served as external JS files so that no inline scripts
    // are needed. This keeps the CSP 'script-src \'self\' \'unsafe-eval\'' valid
    // without adding 'unsafe-inline'.
    //
    // /_lml-dev.js          — sets window.__lmlDev = true (verbose errors)
    // /_lml-reload-client.js — SSE live-reload client (only when liveReload=true)
    const devJs = 'window.__lmlDev=true;';
    const reloadJs = [
        '(function(){',
        "  var es=new EventSource('/_lml-reload');",
        "  es.onmessage=function(e){if(e.data==='reload')location.reload();};",
        '  es.onerror=function(){es.close();};',
        '})();',
    ].join('\n');
    const rawShell = generateShellHtml({
        ...(options.title !== undefined && { title: options.title }),
        ...(options.lang !== undefined && { lang: options.lang }),
        ...(options.headExtra !== undefined && { headExtra: options.headExtra }),
    });
    // Inject external script references — no inline JS, so no 'unsafe-inline' needed.
    const shellWithDev = rawShell.replace('</body>', '<script src="/_lml-dev.js"></script>\n</body>');
    const shellHtml = liveReload
        ? shellWithDev.replace('</body>', '<script src="/_lml-reload-client.js"></script>\n</body>')
        : shellWithDev;
    // ── SSE client registry ───────────────────────────────────────────────────
    const sseClients = new Set();
    function broadcast(event) {
        for (const res of sseClients) {
            res.write('data: ' + event + '\n\n');
        }
    }
    // ── File watcher ──────────────────────────────────────────────────────────
    if (liveReload) {
        try {
            watch(root, { recursive: true }, (_event, filename) => {
                if (filename) {
                    const rel = filename.toString();
                    process.stdout.write('  changed  ' + rel + '\n');
                    routeMap = buildRouteMap(); // keep route map in sync with filesystem
                    broadcast('reload');
                }
            });
        }
        catch {
            // fs.watch with recursive: true is not supported on all platforms for
            // all directory types; fail silently and continue without live reload.
            console.warn('  Warning: file watching unavailable on this platform.');
        }
    }
    // ── Request handler ───────────────────────────────────────────────────────
    function handleRequest(req, res) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);
        // ── SSE endpoint ─────────────────────────────────────────────────────────
        if (liveReload && pathname === '/_lml-reload') {
            if (sseClients.size >= maxSseClients) {
                res.writeHead(503, { 'Content-Type': 'text/plain' });
                res.end('Too many live-reload connections');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write(': connected\n\n'); // initial comment keeps the connection open
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
        }
        // ── Route map (lml-routes.json) ──────────────────────────────────────────
        // Served dynamically so it always reflects the current filesystem state.
        if (pathname === '/lml-routes.json') {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            res.end(JSON.stringify(routeMap, null, 2));
            return;
        }
        // ── In-memory lml-runtime.js ─────────────────────────────────────────────
        if (pathname === '/lml-runtime.js') {
            res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            res.end(runtimeJs);
            return;
        }
        // ── In-memory dev scripts ─────────────────────────────────────────────────
        if (pathname === '/_lml-dev.js') {
            res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            res.end(devJs);
            return;
        }
        if (liveReload && pathname === '/_lml-reload-client.js') {
            res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            res.end(reloadJs);
            return;
        }
        // ── Compiled page modules (*.lml.js) ────────────────────────────────────────
        // The browser runtime requests page.lml.js.
        //
        // Two workflows are supported:
        //   1. Source directory (lmlc serve src/):  compile page.lml on the fly.
        //   2. Built directory  (lmlc serve dist/): serve the precompiled page.lml.js
        //      directly (lmlc --project already compiled it).
        //
        // Order: precompiled .lml.js → compile from .lml → "not found" module.
        // Security: all paths are verified to stay within root.
        if (pathname.endsWith('.lml.js')) {
            const relJs = pathname.slice(1); // e.g. 'about.lml.js'
            const relLml = relJs.slice(0, -3); // e.g. 'about.lml'
            const jsAbsPath = resolve(join(root, relJs));
            const lmlAbsPath = resolve(join(root, relLml));
            if (!jsAbsPath.startsWith(root + '/') || !lmlAbsPath.startsWith(root + '/')) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            // 1. Serve a precompiled .lml.js if it already exists (dist/ workflow).
            try {
                if (statSync(jsAbsPath).isFile()) {
                    res.writeHead(200, {
                        'Content-Type': 'application/javascript; charset=utf-8',
                        'Cache-Control': 'no-cache',
                    });
                    res.end(readFileSync(jsAbsPath));
                    return;
                }
            }
            catch { /* file absent — continue to on-the-fly compilation */ }
            // 2. Compile from .lml source (src/ workflow).
            // Try the direct .lml path first; fall back to directory index.
            const lmlCandidates = [lmlAbsPath];
            const withoutExt = relLml.endsWith('.lml') ? relLml.slice(0, -4) : relLml;
            const indexAbs = resolve(join(root, withoutExt, 'index.lml'));
            if (indexAbs.startsWith(root + '/'))
                lmlCandidates.push(indexAbs);
            let sourcePath = null;
            for (const c of lmlCandidates) {
                try {
                    if (statSync(c).isFile()) {
                        sourcePath = c;
                        break;
                    }
                }
                catch { /* skip */ }
            }
            if (!sourcePath) {
                // Return a valid JS module that throws rather than a plain-text 404.
                // A plain-text body mis-parsed as JavaScript produces a confusing SyntaxError.
                const notFoundJs = 'export default async function(){throw new Error('
                    + JSON.stringify('Page not found: ' + pathname) + ');}';
                res.writeHead(200, {
                    'Content-Type': 'application/javascript; charset=utf-8',
                    'Cache-Control': 'no-cache',
                });
                res.end(notFoundJs);
                return;
            }
            try {
                const source = readFileSync(sourcePath, 'utf-8');
                const { script, lml } = splitScriptAndLml(source);
                const reader = (relPath) => {
                    try {
                        const src = readFileSync(resolve(join(root, relPath)), 'utf-8');
                        const parts = splitScriptAndLml(src);
                        return { script: parts.script, nodes: parse(parts.lml) };
                    }
                    catch {
                        return null;
                    }
                };
                const js = compilePageToJs({ script, nodes: parse(lml) }, reader);
                res.writeHead(200, {
                    'Content-Type': 'application/javascript; charset=utf-8',
                    'Cache-Control': 'no-cache',
                });
                res.end(js);
            }
            catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(String(err));
            }
            return;
        }
        // ── Real file from srcDir ────────────────────────────────────────────────
        // Security: resolve the path and verify it stays within root.
        const filePath = resolve(join(root, pathname));
        if (!filePath.startsWith(root + '/') && filePath !== root) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        let stat = null;
        try {
            stat = statSync(filePath);
        }
        catch { /* not found */ }
        if (stat?.isFile()) {
            const ext = extname(filePath).toLowerCase();
            const mime = MIME[ext] ?? 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
            res.end(readFileSync(filePath));
            return;
        }
        // ── .lml miss → try directory index fallback, then 404 ──────────────────
        // The browser runtime fetches .lml files directly. If the exact file
        // doesn't exist, check whether a directory index exists:
        //   /contact.lml → /contact/index.lml
        // This mirrors how web servers handle directory URLs so that a project
        // structured as contact/index.lml is reachable at /contact.
        if (pathname.endsWith('.lml')) {
            const withoutExt = pathname.slice(0, -4); // strip .lml
            const indexPath = resolve(join(root, withoutExt, 'index.lml'));
            const indexInRoot = indexPath.startsWith(root + '/') || indexPath === root;
            let indexStat = null;
            if (indexInRoot) {
                try {
                    indexStat = statSync(indexPath);
                }
                catch { /* not found */ }
            }
            if (indexStat?.isFile()) {
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(readFileSync(indexPath));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + pathname);
            return;
        }
        // ── SPA fallback → shell ─────────────────────────────────────────────────
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
        });
        res.end(shellHtml);
    }
    // ── Start server ──────────────────────────────────────────────────────────
    const server = createServer(handleRequest);
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error('Error: port ' + port + ' is already in use. Try --port <n>.');
        }
        else {
            console.error('Server error: ' + err.message);
        }
        process.exit(1);
    });
    server.listen(port, host, () => {
        const url = 'http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port;
        console.log('\nLML dev server');
        console.log('  Local:    ' + url);
        if (host === '0.0.0.0')
            console.log('  Network:  http://<your-ip>:' + port);
        console.log('  Root:     ' + root);
        if (liveReload)
            console.log('  Reload:   enabled (watching ' + root + ')');
        console.log('\nPress Ctrl+C to stop.\n');
    });
}
//# sourceMappingURL=devserver.js.map