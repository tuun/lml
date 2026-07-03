# LML — Lightweight Markup Language

LML is a proposed alternative to HTML, which is light-weight strictly typed, and  indentation-based. Instead of typeing every closing html tag, LML proposes that these are unnecessary, and removing them makes typing the markup easier and faster. It also hase the benefit of reduced data transfer, as less bytes travel over the wire. 

The `lmlc` compiler turns `.lml` files into standard `.html` files. In a dream world, this would be implemented on a browser level, so LML files could be understood and compiled natively. For now, we have a Javascript based compiler which can detect .lml responses, and transform them in to valid HTML for rendering by the current browser.

With Single Page Application(s) (SPA) dominating the world of web rendering, LML also proposes that links behave as SPA by default. When running a dev server, or builing in project mode, SPA behaviour happens automatically - no third party dependencies needed.

## Why

HTML becomes hard to read and edit when too many elements are not indented properly. By creating a strictly typed tabulated markup language that honours existing HTML elements, we can ensure clean codebases, and can forget about tracking down the correct closing </div> tag.

## Install

```sh
npm install -g lmlc
```

## Side by Side

**HTML:**
```html
<div class="min-h-screen flex flex-col items-center justify-between px-4 py-6 bg-gray-100 dark:bg-gray-900">
  <header class="w-full max-w-5xl">
    <nav class="flex gap-4">
      <a href="/" class="text-sm font-medium hover:underline">Home</a>
    </nav>
  </header>
</div>
```

**LML:**
```
<div
class="min-h-screen flex flex-col items-center justify-between px-4 py-6 bg-gray-100 dark:bg-gray-900"
  <header
  class="w-full max-w-5xl"
    <nav
    class="flex gap-4"
      <a
      href="/"
      class="text-sm font-medium hover:underline"
        Home
      >
    >
  >
>
```

## Syntax

| Construct | How to write it |
|---|---|
| Open an element | `<tagname` on its own line |
| Add attributes | Indented lines below the tag: `name="value"`, `name='value'`, `name=value`, or bare `name` for boolean attributes |
| Add child elements | Nest another `<tagname` at a deeper indent |
| Add text content | A plain text line inside the element |
| Close an element | `>` at the same indent level as the opening `<tagname` |
| Comments | Standard HTML comments `<!-- ... -->` — ignored by the compiler |
| Void elements | `<br`, `<img`, `<input`, etc. — close automatically, no `>` needed |

### Indentation rules

- Attributes must be indented **more** than their tag.
- Children must be indented **more** than their tag.
- The closing `>` must align exactly with the opening `<tagname`.
- Spaces and tabs are both accepted (tabs count as 2 spaces).


Or run directly from the project after building:

```sh
npm run build
npm link   # makes `lmlc` available globally
```

## Usage

### Single file

```sh
lmlc <input.lml> [output.html]
```

If `output.html` is omitted the compiled file is written next to the input with an `.html` extension.

| Flag | Description |
|---|---|
| `--no-doctype` | Do not prepend `<!DOCTYPE html>` |
| `--minify` | Emit minified HTML (no indentation or newlines) |
| `-h`, `--help` | Show help |

```sh
# Compile and write to index.html
lmlc src/index.lml

# Compile to a specific output path
lmlc src/index.lml dist/index.html

# Compile for production (minified, no doctype for a partial)
lmlc --minify --no-doctype components/card.lml dist/card.html
```

### Development server

```sh
lmlc serve [src-dir] [options]
```

`src-dir` defaults to the current directory.

| Flag | Description |
|---|---|
| `--port <n>` | Port to listen on (default: `3000`) |
| `--no-reload` | Disable live reload |
| `--title <text>` | Default `<title>` for the shell (default: `LML App`) |
| `--lang <code>` | `html[lang]` attribute (default: `en`) |

```sh
# Serve the current directory on http://localhost:3000
lmlc serve

# Serve a specific source directory on a custom port
lmlc serve src --port 8080

# Disable live reload (useful when running inside a container)
lmlc serve src --no-reload
```

The dev server mirrors production exactly:

- `.lml` files are served as `text/plain` — the same fetch the browser runtime uses in production
- `lml-runtime.js` is served from memory (always reflects the installed version of `lmlc`)
- `index.html` shell is served from memory for every non-file URL (SPA fallback)
- Other static assets (`*.css`, images, fonts) are served from `src-dir`
- Any `.lml` file change triggers an instant page reload via Server-Sent Events — no WebSocket, no extra dependencies

> **Testing single-file compilation locally**  
> If you haven't run `npm link` yet, invoke the compiler directly:  
> `node dist/index.js example.lml` or `npm run compile -- example.lml`

### Project mode

Compile an entire directory tree and generate everything needed to run the site as a **single-page application**: the `.lml` source files are copied as-is to the output directory, and `lmlc` generates a thin browser runtime that fetches and renders each page on demand.

#### Why SPA?

- The browser only ever downloads the LML source for the page it's visiting — not the pre-rendered HTML for every page.
- LML files are smaller than equivalent HTML (no closing tags, no repetitive attribute markup).
- The runtime (~4 KB) is cached after the first load; subsequent navigations are a single small `fetch()`.
- The server needs no special per-page knowledge — just two rules: serve `.lml` files as text, send everything else to `index.html`.

```sh
lmlc --project <src-dir> [out-dir] [options]
```

`out-dir` defaults to `./dist`.

| Flag | Description |
|---|---|
| `--apache` | Emit `.htaccess` in the output directory |
| `--nginx` | Emit `nginx.conf` in the output directory |
| `--custom-404` | Wire up `404.lml` as the SPA error page |
| `--title <text>` | Default `<title>` for the shell page (default: `LML App`) |
| `--lang <code>` | `html[lang]` attribute for the shell (default: `en`) |
| `--server-name <host>` | `server_name` for the nginx config (default: `example.com`) |
| `--nginx-root <path>` | `root` directive for the nginx config (default: `/var/www/html`) |
| `--ssl` | Add an SSL/TLS stanza to the nginx config |
| `--https-redirect` | Add an HTTP→HTTPS redirect server block (implies `--ssl`) |

```sh
# Compile src/ → dist/ and print the URL route table
lmlc --project src dist

# Also emit .htaccess for Apache
lmlc --project src dist --apache

# Also emit nginx.conf for nginx
lmlc --project src dist --nginx --server-name mysite.com --nginx-root /var/www/mysite

# Full production build: both configs, HTTPS redirect, custom 404
lmlc --project src dist --apache --nginx \
     --server-name mysite.com --nginx-root /var/www/mysite \
     --https-redirect --custom-404
```

#### What gets generated

For a project with this source layout:

```
src/
  index.lml
  about.lml
  blog/
    index.lml
    my-post.lml
```

Running `lmlc --project src dist --apache` produces:

```
dist/
  index.lml          ← copied source (fetched for /)
  about.lml          ← copied source (fetched for /about)
  blog/
    index.lml        ← copied source (fetched for /blog/)
    my-post.lml      ← copied source (fetched for /blog/my-post)
  index.html         ← SPA shell (served for every route)
  lml-runtime.js     ← browser parser + SPA router
  .htaccess          ← Apache rewrite rules
```

#### URL mapping

| Source file | URL |
|---|---|
| `index.lml` | `/` |
| `about.lml` | `/about` |
| `blog/index.lml` | `/blog/` |
| `blog/my-post.lml` | `/blog/my-post` |
| `docs/api/ref.lml` | `/docs/api/ref` |

After build the CLI prints the full route table so you can verify the mapping before deploying:

```
Routes (4):
  URL             FILE
  /               index.lml
  /about          about.lml
  /blog/          blog/index.lml
  /blog/my-post   blog/my-post.lml
```

## Deploying a static site

The LML SPA architecture has three moving parts in production:

| File | Role |
|---|---|
| `index.html` | Thin shell served for every HTML route — just a `<div id="lml-app">` and a `<script>` tag |
| `lml-runtime.js` | ~4 KB browser bundle — LML parser + renderer + SPA router |
| `*.lml` | Your page content — copied verbatim, fetched on demand |

The server only needs two rules: **serve `.lml` files as static text** and **send everything else to `index.html`**.

### How it works at runtime

1. User visits `https://mysite.com/blog/my-post`
2. nginx/Apache serves `index.html` (the SPA shell — same file for every route)
3. Browser executes `lml-runtime.js`, which reads `location.pathname` → `/blog/my-post`
4. Runtime fetches `/blog/my-post.lml` from the server
5. Runtime parses the LML source using the same rules as `lmlc`
6. Rendered HTML is injected into `<div id="lml-app">`
7. User clicks `<a href="/about">` → runtime intercepts, `pushState`, fetches `/about.lml`, re-renders — **no full page reload**

### Apache

```sh
lmlc --project src dist --apache --custom-404
rsync -av dist/ user@host:/var/www/html/
```

Requires `mod_rewrite`, `mod_headers`, `mod_expires`, and `mod_mime` — enabled by default on most shared hosts.

<details>
<summary>Example .htaccess output</summary>

```apache
# Generated by lmlc — do not edit by hand
# Requires: mod_rewrite, mod_headers, mod_expires, mod_mime

Options -Indexes
DirectoryIndex index.html

# Serve .lml files as plain text so the JS runtime can fetch them
<IfModule mod_mime.c>
  AddType "text/plain; charset=utf-8" .lml
</IfModule>

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  # Pass .lml source files directly to the browser
  RewriteRule \.lml$ - [L]

  # Pass existing static assets (JS, CSS, images, fonts, etc.)
  RewriteCond %{REQUEST_FILENAME} -f
  RewriteRule ^ - [L]

  # Everything else → SPA shell
  RewriteRule ^ index.html [L]

</IfModule>

# Security headers
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"
</IfModule>

# Cache-control
<IfModule mod_expires.c>
  ExpiresActive On

  # SPA shell — always revalidate
  <FilesMatch "^index\.html$">
    ExpiresDefault "access plus 0 seconds"
    Header always set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>

  # .lml sources — no cache so edits are always fetched fresh
  <FilesMatch "\.lml$">
    ExpiresDefault "access plus 0 seconds"
    Header always set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>

  # Fingerprinted static assets — immutable for 1 year
  ExpiresByType text/css               "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/png              "access plus 1 year"
</IfModule>
```

</details>

### nginx

```sh
lmlc --project src dist --nginx \
     --server-name mysite.com \
     --nginx-root /var/www/mysite \
     --https-redirect \
     --custom-404

rsync -av dist/ user@host:/var/www/mysite/
scp dist/nginx.conf user@host:/etc/nginx/sites-available/mysite
ssh user@host "ln -sf /etc/nginx/sites-available/mysite /etc/nginx/sites-enabled/ \
               && nginx -t && systemctl reload nginx"
```

<details>
<summary>Example nginx.conf output (with --https-redirect)</summary>

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name mysite.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name mysite.com;
    root /var/www/mysite;
    index index.html;
    charset utf-8;

    ssl_certificate     /etc/ssl/certs/mysite.com.crt;
    ssl_certificate_key /etc/ssl/private/mysite.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # .lml source files — fetched by lml-runtime.js on every navigation
    location ~* \.lml$ {
        default_type "text/plain; charset=utf-8";
        add_header Cache-Control "no-cache, must-revalidate" always;
        try_files $uri =404;
    }

    # SPA shell — all routes fall through to index.html
    location / {
        try_files $uri /index.html;
        location = /index.html {
            add_header Cache-Control "no-cache, must-revalidate" always;
        }
    }

    # Fingerprinted static assets
    location ~* \.(css|js|woff2|png|jpg|svg|webp|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
    }

    location ~ /\. { deny all; }
}
```

</details>

### Custom 404 page

Add a `404.lml` to your source directory and pass `--custom-404`:

```sh
lmlc --project src dist --apache --custom-404
```

When the runtime fetches a `.lml` file and gets a 404 response, it automatically falls back to `/404.lml` and renders it. The 404 page is fetched once and cached in memory for the session.

## Real-world use cases

### Email templates

HTML emails require heavily attributed tables, `td` elements with inline styles, and deeply nested structures that are painful to maintain. LML keeps the hierarchy readable:

```
<table
role="presentation"
width="100%"
cellpadding="0"
cellspacing="0"
style="background-color:#f4f4f4"
  <tr
    <td
    align="center"
    style="padding:40px 0"
      <table
      role="presentation"
      width="600"
      cellpadding="0"
      cellspacing="0"
      style="background-color:#ffffff;border-radius:8px"
        <tr
          <td
          style="padding:32px 40px;font-family:sans-serif;font-size:16px;color:#333333"
            Welcome to our service.
          >
        >
      >
    >
  >
>
```

### Component authoring in build pipelines

Drop `lmlc` into any build pipeline. The project mode SPA build fits naturally into an npm script:

```json
"scripts": {
  "build": "lmlc --project src dist --apache --nginx --server-name mysite.com --nginx-root /var/www/mysite"
}
```

### Generating server-rendered fragments

When a backend emits HTML fragments (HTMX partial swaps, Rails partials, Django includes), keep the fragments readable in LML and use single-file mode to compile them at build time:

```sh
# Compile a single partial (no doctype, minified)
lmlc --no-doctype --minify src/partials/card.lml dist/partials/card.html
```

## Programmatic API

`lmlc` exposes all its internals for use in Node.js tooling:

```ts
import { parse } from './src/parser.js';
import { emit } from './src/codegen.js';
import { generateApacheHtaccess, generateNginxConf, fileToUrl } from './src/server.js';
import { generateBrowserRuntime, generateShellHtml } from './src/runtime.js';

// Compile a single LML string to HTML
const ast  = parse('<div\nclass="container"\n  Hello, world!\n>');
const html = emit(ast, { pretty: true, doctype: false });
// <div class="container">
//   Hello, world!
// </div>

// Generate the SPA shell and runtime programmatically
const shell   = generateShellHtml({ title: 'My Site', lang: 'en' });
const runtime = generateBrowserRuntime();

// Generate server configs
const htaccess = generateApacheHtaccess({ custom404: true });
const nginxConf = generateNginxConf({
  serverName: 'mysite.com',
  root: '/var/www/mysite',
  ssl: true,
  httpsRedirect: true,
  custom404: true,
});

// Map a .lml source path to its browser URL
fileToUrl('blog/my-post.lml');  // → '/blog/my-post'
fileToUrl('index.lml');          // → '/'
```

### `parse(source: string): Document`

Parses LML source text into an AST. Throws `ParseError` (with a 1-based `line` property) on invalid input.

### `emit(document: Document, options?): string`

Serialises an AST to an HTML string.

| Option | Type | Default | Description |
|---|---|---|---|
| `pretty` | `boolean` | `true` | Indent output |
| `doctype` | `boolean` | `true` | Prepend `<!DOCTYPE html>` when root is `<html>` |

### `generateShellHtml(options?): string`

Generates the `index.html` SPA shell.

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | `'LML App'` | Default page title before first navigation |
| `lang` | `string` | `'en'` | `<html lang="...">` attribute |
| `headExtra` | `string` | — | Raw HTML injected at the end of `<head>` |

### `generateBrowserRuntime(): string`

Returns the complete `lml-runtime.js` source as a string. The runtime is a self-contained IIFE (~4 KB) that includes the LML parser, HTML renderer, and SPA router. No dependencies.

### `generateApacheHtaccess(options?): string`

Generates an Apache `.htaccess` for the LML SPA.

| Option | Type | Default | Description |
|---|---|---|---|
| `custom404` | `boolean` | `false` | Include a note about `/404.lml` error handling |

### `generateNginxConf(options?): string`

Generates an nginx server block for the LML SPA.

| Option | Type | Default | Description |
|---|---|---|---|
| `serverName` | `string` | `'example.com'` | `server_name` directive |
| `root` | `string` | `'/var/www/html'` | `root` directive |
| `port` | `number` | `80` | Listen port (ignored when `ssl` is true) |
| `ssl` | `boolean` | `false` | Add SSL/TLS stanza |
| `httpsRedirect` | `boolean` | `false` | Add HTTP→HTTPS redirect block |
| `custom404` | `boolean` | `false` | Add `error_page 404` for non-JS clients |

### `fileToUrl(relLml: string): string`

Converts a `.lml` file path (relative to source root) to its canonical browser URL.

## Error messages

Parse errors include the source line number:

```
Compile error: Line 4: Expected '>' to close <div>, got '<span'
```

## License

MIT
