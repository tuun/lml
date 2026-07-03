#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname, basename, dirname, join, relative } from 'node:path';
import { parse, ParseError, splitScriptAndLml } from './parser.js';
import { emit, resolveDocument, execScriptSection, compilePageToJs, type DocumentReader, type JsCompiledReader } from './codegen.js';
import {
  generateApacheHtaccess,
  generateNginxConf,
  fileToUrl,
} from './server.js';
import { generateBrowserRuntime, generateShellHtml } from './runtime.js';
import { startDevServer } from './devserver.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
lmlc — LML compiler and SPA project builder

Usage:
  lmlc [options] <input.lml> [output.html]      Single-file compile
  lmlc --project <src-dir> [out-dir] [options]  Full project / SPA build
  lmlc serve [src-dir] [options]                Local development server

Single-file options:
  -h, --help               Show this help message
  --no-doctype             Do not prepend <!DOCTYPE html>
  --minify                 Emit minified HTML

Project mode (--project):
  --apache                 Emit .htaccess in the output directory
  --nginx                  Emit nginx.conf in the output directory
  --custom-404             Wire up 404.lml as the SPA error page
  --no-route-map           Omit lml-routes.json from the output (reduces file-structure disclosure)
  --title <text>           Default <title> for the shell (default: LML App)
  --lang <code>            html[lang] attribute for the shell (default: en)
  --server-name <host>     nginx server_name  (default: example.com)
  --nginx-root <path>      nginx root directive (default: /var/www/html)
  --ssl                    Add SSL/TLS stanza to nginx config
  --https-redirect         Add HTTP→HTTPS redirect block (implies --ssl)

Dev server (serve):
  --port <n>               Port to listen on (default: 3000)
  --host <ip>              Bind address (default: 127.0.0.1; use 0.0.0.0 to expose on network)
  --no-reload              Disable live reload
  --title <text>           Default <title> for the shell (default: LML App)
  --lang <code>            html[lang] attribute for the shell (default: en)

In project mode lmlc copies .lml source files to the output directory and
generates lml-runtime.js + index.html so the site is rendered client-side.
Output directory defaults to ./dist.
`.trim());
}

// ---------------------------------------------------------------------------
// Single-file mode
// ---------------------------------------------------------------------------

interface SingleFileArgs {
  mode: 'file';
  input: string;
  output: string | null;
  doctype: boolean;
  minify: boolean;
}

// ---------------------------------------------------------------------------
// Dev server mode
// ---------------------------------------------------------------------------

interface ServeArgs {
  mode: 'serve';
  srcDir: string;
  port: number;
  host: string;
  liveReload: boolean;
  title: string;
  lang: string;
}

// ---------------------------------------------------------------------------
// Project / SPA mode
// ---------------------------------------------------------------------------

interface ProjectArgs {
  mode: 'project';
  srcDir: string;
  outDir: string;
  title: string;
  lang: string;
  apache: boolean;
  nginx: boolean;
  custom404: boolean;
  noRouteMap: boolean;
  serverName: string;
  nginxRoot: string;
  ssl: boolean;
  httpsRedirect: boolean;
}

type CliArgs = SingleFileArgs | ProjectArgs | ServeArgs;

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  // ── serve subcommand ────────────────────────────────────────────────────
  if (args[0] === 'serve') {
    const rest = args.slice(1);
    let port       = 3000;
    let host       = '127.0.0.1';
    let liveReload = true;
    let title      = 'LML App';
    let lang       = 'en';
    let srcDir     = '.';

    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === '--no-reload') { liveReload = false; }
      else if (a === '--port') {
        const n = Number(rest[i + 1]);
        if (!n || isNaN(n)) { console.error('Error: --port requires a number.'); process.exit(1); }
        port = n; i++;
      } else if (a === '--host') {
        const v = rest[i + 1];
        if (!v || v.startsWith('-')) { console.error('Error: --host requires a value.'); process.exit(1); }
        host = v; i++;
      } else if (a === '--title') {
        const v = rest[i + 1];
        if (!v || v.startsWith('-')) { console.error('Error: --title requires a value.'); process.exit(1); }
        title = v; i++;
      } else if (a === '--lang') {
        const v = rest[i + 1];
        if (!v || v.startsWith('-')) { console.error('Error: --lang requires a value.'); process.exit(1); }
        lang = v; i++;
      } else if (a.startsWith('-')) {
        console.error('Unknown option: ' + a); process.exit(1);
      } else {
        srcDir = a;
      }
    }
    return { mode: 'serve', srcDir, port, host, liveReload, title, lang };
  }

  let projectMode    = false;
  let doctype        = true;
  let minify         = false;
  let apache         = false;
  let nginx          = false;
  let custom404      = false;
  let noRouteMap     = false;
  let ssl            = false;
  let httpsRedirect  = false;
  let title          = 'LML App';
  let lang           = 'en';
  let serverName     = 'example.com';
  let nginxRoot      = '/var/www/html';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--no-doctype':    doctype = false; break;
      case '--minify':        minify = true; break;
      case '--project':       projectMode = true; break;
      case '--apache':        apache = true; break;
      case '--nginx':         nginx = true; break;
      case '--custom-404':    custom404 = true; break;
      case '--no-route-map':  noRouteMap = true; break;
      case '--ssl':           ssl = true; break;
      case '--https-redirect': httpsRedirect = true; ssl = true; break;
      case '--title': {
        const next = args[i + 1];
        if (!next || next.startsWith('-')) { console.error('Error: --title requires a value.'); process.exit(1); }
        title = next; i++; break;
      }
      case '--lang': {
        const next = args[i + 1];
        if (!next || next.startsWith('-')) { console.error('Error: --lang requires a value.'); process.exit(1); }
        lang = next; i++; break;
      }
      case '--server-name': {
        const next = args[i + 1];
        if (!next || next.startsWith('-')) { console.error('Error: --server-name requires a value.'); process.exit(1); }
        serverName = next; i++; break;
      }
      case '--nginx-root': {
        const next = args[i + 1];
        if (!next || next.startsWith('-')) { console.error('Error: --nginx-root requires a value.'); process.exit(1); }
        nginxRoot = next; i++; break;
      }
      default:
        if (arg.startsWith('-')) { console.error('Unknown option: ' + arg); process.exit(1); }
        positional.push(arg);
    }
  }

  if (projectMode) {
    if (positional.length === 0) {
      console.error('Error: --project requires a source directory.');
      printHelp();
      process.exit(1);
    }
    return {
      mode: 'project',
      srcDir: positional[0]!,
      outDir: positional[1] ?? 'dist',
      title, lang,
      apache, nginx, custom404, noRouteMap,
      serverName, nginxRoot, ssl, httpsRedirect,
    };
  }

  if (positional.length === 0) {
    console.error('Error: no input file specified.');
    printHelp();
    process.exit(1);
  }

  return {
    mode: 'file',
    input: positional[0]!,
    output: positional[1] ?? null,
    doctype,
    minify,
  };
}

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .lml files under a directory, skipping _ prefixed dirs. */
function walkLml(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue; // skip _t, _p, and other special dirs
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkLml(full));
    } else if (entry.endsWith('.lml')) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // ── Dev server mode ───────────────────────────────────────────────────────
  if (args.mode === 'serve') {
    const { srcDir, port, host, liveReload, title, lang } = args;
    startDevServer(srcDir, { port, host, liveReload, title, lang });
    return;
  }

  // ── Single-file mode ──────────────────────────────────────────────────────
  if (args.mode === 'file') {
    const { input, output, doctype, minify } = args;
    const inputPath  = resolve(input);
    const outputPath = output
      ? resolve(output)
      : resolve(dirname(inputPath), basename(inputPath, extname(inputPath)) + '.html');

    let source: string;
    try {
      source = readFileSync(inputPath, 'utf-8');
    } catch {
      console.error('Error: could not read file: ' + inputPath);
      process.exit(1);
    }

    try {
      const { script, lml }  = splitScriptAndLml(source);
      const initialVars      = script.trim() ? await execScriptSection(script) : {};
      const ast              = parse(lml);
      const srcBase          = dirname(inputPath);
      const reader: DocumentReader = (path) => {
        try { return parse(readFileSync(join(srcBase, path), 'utf-8')); }
        catch { return null; }
      };
      const resolved = resolveDocument(ast, reader, initialVars);
      const html     = emit(resolved, { pretty: !minify, doctype });
      writeFileSync(outputPath, html, 'utf-8');
      console.log('Compiled: ' + inputPath + ' → ' + outputPath);
    } catch (err) {
      console.error(err instanceof ParseError ? 'Compile error: ' + err.message : 'Unexpected error: ' + String(err));
      process.exit(1);
    }
    return;
  }

  // ── Project / SPA mode ────────────────────────────────────────────────────
  //
  // Instead of serving raw .lml files for the browser to parse with eval,
  // project mode now compiles each .lml page to a self-contained .lml.js
  // ES module. The browser loads these via import() — no unsafe-eval needed.
  // Templates and partials are fully inlined at compile time;
  // _t/ and _p/ directories are not needed in the output.
  //
  const {
    srcDir, outDir,
    title, lang,
    apache, nginx, custom404, noRouteMap,
    serverName, nginxRoot, ssl, httpsRedirect,
  } = args;

  const srcRoot = resolve(srcDir);
  const outRoot = resolve(outDir);
  mkdirSync(outRoot, { recursive: true });

  const lmlFiles = walkLml(srcRoot);
  if (lmlFiles.length === 0) {
    console.error('No .lml files found in: ' + srcRoot);
    process.exit(1);
  }

  // Build a JsCompiledReader that reads templates/partials from srcRoot.
  const jsReader: JsCompiledReader = (relPath) => {
    try {
      const src = readFileSync(join(srcRoot, relPath), 'utf-8');
      const parts = splitScriptAndLml(src);
      return { script: parts.script, nodes: parse(parts.lml) };
    } catch { return null; }
  };

  // Compile each .lml page to a .lml.js ES module.
  const routes: Array<{ url: string; file: string }> = [];

  for (const inputPath of lmlFiles) {
    const relLml    = relative(srcRoot, inputPath).replace(/\\/g, '/');
    const relJs     = relLml + '.js'; // e.g. about.lml.js
    const outputPath = join(outRoot, relJs);
    mkdirSync(dirname(outputPath), { recursive: true });
    try {
      const source  = readFileSync(inputPath, 'utf-8');
      const { script, lml } = splitScriptAndLml(source);
      const js = compilePageToJs({ script, nodes: parse(lml) }, jsReader);
      writeFileSync(outputPath, js, 'utf-8');
    } catch (err) {
      console.error('Compile error in ' + relLml + ': ' + String(err));
      process.exit(1);
    }
    const url = fileToUrl(relLml);
    routes.push({ url, file: relJs });
    console.log('  compiled  ' + relLml + '  →  ' + relJs + '  (' + url + ')');
  }

  // Route table
  console.log('\nRoutes (' + routes.length + '):');
  const maxUrl = Math.max(...routes.map(r => r.url.length), 3);
  console.log('  ' + 'URL'.padEnd(maxUrl) + '  FILE');
  for (const { url, file } of routes.sort((a, b) => a.url.localeCompare(b.url))) {
    console.log('  ' + url.padEnd(maxUrl) + '  ' + file);
  }

  // lml-runtime.js
  const runtimeDest = join(outRoot, 'lml-runtime.js');
  writeFileSync(runtimeDest, generateBrowserRuntime(), 'utf-8');
  console.log('\nWrote: ' + runtimeDest);

  // lml-routes.json — maps clean URL → compiled .lml.js module path.
  // Consumed by the browser runtime for route-aware link interception.
  // Omitted when --no-route-map is passed (reduces file-structure disclosure).
  if (!noRouteMap) {
    const routeMapObj: Record<string, string> = {};
    for (const { url, file } of routes) routeMapObj[url] = file;
    const routesDest = join(outRoot, 'lml-routes.json');
    writeFileSync(routesDest, JSON.stringify(routeMapObj, null, 2), 'utf-8');
    console.log('Wrote: ' + routesDest);
  }

  // index.html (SPA shell)
  const shellDest = join(outRoot, 'index.html');
  writeFileSync(shellDest, generateShellHtml({ title, lang }), 'utf-8');
  console.log('Wrote: ' + shellDest);

  // .htaccess
  if (apache) {
    const dest = join(outRoot, '.htaccess');
    writeFileSync(dest, generateApacheHtaccess({ custom404 }), 'utf-8');
    console.log('Wrote: ' + dest);
  }

  // nginx.conf
  if (nginx) {
    const dest = join(outRoot, 'nginx.conf');
    writeFileSync(dest, generateNginxConf({ serverName, root: nginxRoot, ssl, httpsRedirect, custom404 }), 'utf-8');
    console.log('Wrote: ' + dest);
  }

  console.log('\nDone. Output: ' + outRoot);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

