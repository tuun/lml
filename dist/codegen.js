// ---------------------------------------------------------------------------
// Void (self-closing) HTML elements — must not have a closing tag
// ---------------------------------------------------------------------------
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------
function escapeAttr(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function escapeText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
// ---------------------------------------------------------------------------
// Attribute serialisation
// ---------------------------------------------------------------------------
function renderAttrs(attributes) {
    if (attributes.length === 0)
        return '';
    const parts = attributes.map(({ name, value }) => value === null ? name : `${name}="${escapeAttr(value)}"`);
    return ' ' + parts.join(' ');
}
// ---------------------------------------------------------------------------
// Node rendering
// ---------------------------------------------------------------------------
function renderNode(node, depth, pretty) {
    const pad = pretty ? '  '.repeat(depth) : '';
    const nl = pretty ? '\n' : '';
    if (node.kind === 'text') {
        return `${pad}${escapeText(node.content)}${nl}`;
    }
    const { tag, attributes, children } = node;
    const attrs = renderAttrs(attributes);
    if (VOID_ELEMENTS.has(tag)) {
        // Void elements cannot have children in LML; any declared children are an
        // authoring error but we emit them as siblings to avoid silent data loss.
        return `${pad}<${tag}${attrs}>${nl}`;
    }
    if (children.length === 0) {
        return `${pad}<${tag}${attrs}></${tag}>${nl}`;
    }
    const inner = children
        .map(child => renderNode(child, depth + 1, pretty))
        .join('');
    return `${pad}<${tag}${attrs}>${nl}${inner}${pad}</${tag}>${nl}`;
}
/** Evaluates a JS expression string against a vars object, returning the result as a string. */
function interpolate(text, vars) {
    return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, rawExpr) => {
        const expr = rawExpr.trim();
        if (!expr || expr === 'children')
            return ''; // 'children' is handled at AST level
        try {
            const keys = Object.keys(vars);
            const values = Object.values(vars);
            const fn = new Function(...keys, 'return (' + expr + ')');
            const result = fn(...values);
            return result == null ? '' : String(result);
        }
        catch (e) {
            console.warn(`[lml] expression error in {{ ${expr} }}: ${e.message}`);
            return '';
        }
    });
}
/** Parses a v={...} block into key/rawValue pairs (values may be quoted strings or JS expressions). */
function parseInlineVars(s) {
    const result = {};
    const inner = s.trim().replace(/^\{/, '').replace(/\}$/, '');
    const pairs = [];
    let depth = 0, start = 0;
    for (let ci = 0; ci < inner.length; ci++) {
        const ch = inner[ci];
        if (ch === '{' || ch === '[' || ch === '(')
            depth++;
        else if (ch === '}' || ch === ']' || ch === ')')
            depth--;
        else if (ch === ',' && depth === 0) {
            pairs.push(inner.slice(start, ci).trim());
            start = ci + 1;
        }
    }
    pairs.push(inner.slice(start).trim());
    for (const pair of pairs) {
        const colon = pair.indexOf(':');
        if (colon === -1)
            continue;
        const key = pair.slice(0, colon).trim();
        const val = pair.slice(colon + 1).trim();
        if (key)
            result[key] = val; // raw value — callers evaluate against vars
    }
    return result;
}
/** Evaluates a raw v={} value against a vars context. Quoted strings are literals; all else is JS. */
function evalVarValue(raw, vars) {
    if (!raw)
        return '';
    const q = raw[0];
    if ((q === '\'' || q === '"') && raw[raw.length - 1] === q)
        return raw.slice(1, -1);
    try {
        const keys = Object.keys(vars);
        const vals = Object.values(vars);
        const fn = new Function(...keys, 'return (' + raw + ')');
        const r = fn(...vals);
        return r == null ? '' : r;
    }
    catch (e) {
        console.warn(`[lml] v={} expression error for value ${JSON.stringify(raw)}: ${e.message}`);
        return '';
    }
}
function resolveNodes(nodes, reader, vars, childNodes = []) {
    return nodes.flatMap((node) => {
        if (node.kind === 'text') {
            if (node.content.trim() === '{{ children }}')
                return childNodes;
            return [{ kind: 'text', content: interpolate(node.content, vars), line: node.line }];
        }
        if (node.tag.startsWith('t.')) {
            const name = node.tag.slice(2);
            const tmpl = reader('_t/' + name + '.lml');
            if (tmpl === null)
                throw new Error('Template not found: _t/' + name + '.lml');
            const slot = resolveNodes(node.children, reader, vars, childNodes);
            return resolveNodes(tmpl, reader, vars, slot);
        }
        if (node.tag.startsWith('p.')) {
            const name = node.tag.slice(2);
            const partial = reader('_p/' + name + '.lml');
            if (partial === null)
                throw new Error('Partial not found: _p/' + name + '.lml');
            const vAttr = node.attributes.find(a => a.name === 'v');
            const rawPVars = vAttr?.value ? parseInlineVars(vAttr.value) : {};
            const pVars = Object.fromEntries(Object.entries(rawPVars).map(([k, v]) => [k, evalVarValue(v, vars)]));
            return resolveNodes(partial, reader, { ...vars, ...pVars });
        }
        return [{
                kind: 'element',
                tag: node.tag,
                line: node.line,
                attributes: node.attributes.map(a => ({
                    ...a,
                    value: a.value !== null ? interpolate(a.value, vars) : null,
                })),
                children: resolveNodes(node.children, reader, vars, childNodes),
            }];
    });
}
/**
 * Resolves all `<t.*>` template and `<p.*>` partial references in `doc`,
 * returning a new Document with each such node replaced by its expanded
 * content.  Loaded files are read via `reader`.  Throws if a referenced
 * template or partial cannot be found.
 */
export function resolveDocument(doc, reader, initialVars = {}) {
    return resolveNodes(doc, reader, initialVars);
}
/**
 * Executes the script section of an LML file (the code before `return`)
 * as an async function in Node.js and returns the resolved variable values.
 * Any Promise values are automatically awaited so callers can use either
 * `const x = await fetch(...)` or `const x = fetch(...).then(...)`.
 */
export async function execScriptSection(script) {
    // SECURITY: The script section is executed with full Node.js process permissions
    // (file system, network, child_process, etc.).  Only run lmlc on .lml files
    // from trusted sources — treat them with the same trust level as .js files.
    // Never pass user-uploaded or untrusted content to this function.
    const varNames = [];
    const re = /^(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm;
    let m;
    while ((m = re.exec(script)) !== null)
        varNames.push(m[1]);
    const returnStmt = varNames.length
        ? 'return { ' + varNames.join(', ') + ' };'
        : 'return {};';
    const factory = new Function('return (async function () {\n' + script + '\n' + returnStmt + '\n})();');
    const raw = await factory();
    const resolved = {};
    for (const [k, v] of Object.entries(raw)) {
        resolved[k] = (v !== null && typeof v.then === 'function')
            ? await v
            : v;
    }
    return resolved;
}
/**
 * Converts a parsed LML Document AST into an HTML string.
 */
export function emit(document, options = {}) {
    const pretty = options.pretty ?? true;
    const doctype = options.doctype ?? true;
    const html = document
        .map(node => renderNode(node, 0, pretty))
        .join('');
    const firstRoot = document[0];
    const shouldAddDoctype = doctype &&
        firstRoot?.kind === 'element' &&
        firstRoot.tag.toLowerCase() === 'html';
    return shouldAddDoctype ? `<!DOCTYPE html>\n${html}` : html;
}
/** Converts text containing {{ expr }} into a JS expression that evaluates to the final string. */
function textToJsExpr(text, childrenVar) {
    const re = /\{\{([\s\S]*?)\}\}/g;
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last)
            parts.push(JSON.stringify(text.slice(last, m.index)));
        const expr = m[1].trim();
        if (expr === 'children') {
            parts.push(childrenVar);
        }
        else if (expr) {
            parts.push('__esc(' + expr + ')');
        }
        last = m.index + m[0].length;
    }
    if (last < text.length)
        parts.push(JSON.stringify(text.slice(last)));
    return parts.length > 0 ? parts.join('+') : '""';
}
/** Like textToJsExpr but uses __str (no HTML escaping) — for title/plain text contexts. */
function textToJsExprRaw(text) {
    const re = /\{\{([\s\S]*?)\}\}/g;
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last)
            parts.push(JSON.stringify(text.slice(last, m.index)));
        const expr = m[1].trim();
        if (expr)
            parts.push('__str(' + expr + ')');
        last = m.index + m[0].length;
    }
    if (last < text.length)
        parts.push(JSON.stringify(text.slice(last)));
    return parts.length > 0 ? parts.join('+') : 'null';
}
/** Attribute value expression for innerHTML contexts — HTML-escapes dynamic parts. */
function attrValToJsExpr(value) {
    if (!/\{\{/.test(value))
        return JSON.stringify(escapeAttr(value));
    const re = /\{\{([\s\S]*?)\}\}/g;
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(value)) !== null) {
        const before = value.slice(last, m.index);
        if (before)
            parts.push(JSON.stringify(escapeAttr(before)));
        const expr = m[1].trim();
        if (expr)
            parts.push('__escAttr(' + expr + ')');
        last = m.index + m[0].length;
    }
    const after = value.slice(last);
    if (after)
        parts.push(JSON.stringify(escapeAttr(after)));
    return parts.length > 0 ? parts.join('+') : '""';
}
/** Attribute value expression for head nodes — uses __str since values go via setAttribute. */
function headAttrValToJsExpr(value) {
    if (!/\{\{/.test(value))
        return JSON.stringify(value);
    const re = /\{\{([\s\S]*?)\}\}/g;
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(value)) !== null) {
        const before = value.slice(last, m.index);
        if (before)
            parts.push(JSON.stringify(before));
        const expr = m[1].trim();
        if (expr)
            parts.push('__str(' + expr + ')');
        last = m.index + m[0].length;
    }
    const after = value.slice(last);
    if (after)
        parts.push(JSON.stringify(after));
    return parts.length > 0 ? parts.join('+') : '""';
}
/** Generates a JS expression for the opening tag of an HTML element. */
function openTagToJsExpr(tag, attrs) {
    // Build the expression by walking attrs; static text is accumulated in `cur`
    // and flushed to `parts` when a dynamic attr is encountered.
    const parts = [];
    let cur = '<' + tag;
    for (const attr of attrs) {
        if (attr.value === null) {
            cur += ' ' + attr.name;
        }
        else if (!/\{\{/.test(attr.value)) {
            cur += ' ' + attr.name + '="' + escapeAttr(attr.value) + '"';
        }
        else {
            cur += ' ' + attr.name + '="';
            parts.push(JSON.stringify(cur));
            cur = '';
            parts.push(attrValToJsExpr(attr.value));
            cur = '"';
        }
    }
    cur += '>';
    parts.push(JSON.stringify(cur));
    return parts.join('+');
}
/** Serialises a head AST node to a JS object literal (no eval — values computed inline). */
function headNodeToJsLiteral(node) {
    if (node.kind === 'text') {
        return '{kind:"text",content:' + JSON.stringify(node.content) + '}';
    }
    const attrsCode = node.attributes.map(a => '{name:' + JSON.stringify(a.name) + ',value:' + (a.value === null ? 'null' : headAttrValToJsExpr(a.value)) + '}').join(',');
    const childrenCode = node.children.map(headNodeToJsLiteral).join(',');
    return '{kind:"element",tag:' + JSON.stringify(node.tag) + ',attributes:[' + attrsCode + '],children:[' + childrenCode + ']}';
}
/** Core recursive node emitter — produces JS statements that append to `__out`. */
function emitNodesJsCode(nodes, reader, indent, childrenVar, counter) {
    const lines = [];
    for (const node of nodes) {
        // ── Text node ──────────────────────────────────────────────────────────
        if (node.kind === 'text') {
            if (node.content.trim() === '{{ children }}') {
                lines.push(indent + '__out+=' + childrenVar + ';');
            }
            else {
                const expr = textToJsExpr(node.content, childrenVar);
                if (expr !== '""')
                    lines.push(indent + '__out+=' + expr + ';');
            }
            continue;
        }
        // ── Template ───────────────────────────────────────────────────────────
        if (node.tag.startsWith('t.')) {
            const tmplName = node.tag.slice(2);
            const tmplResult = reader('_t/' + tmplName + '.lml');
            if (!tmplResult)
                throw new Error('Template not found: _t/' + tmplName + '.lml');
            const n = counter.n++;
            const chVar = '__ch' + n;
            const vAttr = node.attributes.find(a => a.name === 'v');
            const rawVars = vAttr?.value ? parseInlineVars(vAttr.value) : {};
            const varEntries = Object.entries(rawVars);
            const hasScript = tmplResult.script.trim().length > 0;
            const hasVars = varEntries.length > 0;
            // Build children string — always async so nested templates/partials (which
            // use await) are valid inside the function body.
            const childrenCode = emitNodesJsCode(node.children, reader, indent + '  ', '""', counter);
            if (childrenCode.trim()) {
                lines.push(indent + 'var ' + chVar + '=await(async function(){var __out="";');
                lines.push(childrenCode);
                lines.push(indent + 'return __out;})();');
            }
            else {
                lines.push(indent + 'var ' + chVar + '="";');
            }
            // Template expansion async IIFE
            lines.push(indent + '__out+=await(async function(__children){');
            if (hasScript) {
                lines.push(indent + '  // _t/' + tmplName + '.lml script section');
                for (const line of tmplResult.script.split('\n')) {
                    lines.push(indent + '  ' + line);
                }
            }
            if (hasVars) {
                // Nest v={} vars in an inner function so they shadow any same-named
                // template-script vars without causing a re-declaration error.
                const paramDestr = '{' + varEntries.map(([k]) => k).join(',') + '}';
                const argObj = '{' + varEntries.map(([k, v]) => k + ':(' + v + ')').join(',') + '}';
                lines.push(indent + '  return await(async function(' + paramDestr + '){');
                lines.push(indent + '    var __out="";');
                lines.push(emitNodesJsCode(tmplResult.nodes, reader, indent + '    ', '__children', counter));
                lines.push(indent + '    return __out;');
                lines.push(indent + '  })(' + argObj + ');');
            }
            else {
                lines.push(indent + '  var __out="";');
                lines.push(emitNodesJsCode(tmplResult.nodes, reader, indent + '  ', '__children', counter));
                lines.push(indent + '  return __out;');
            }
            lines.push(indent + '})(' + chVar + ');');
            continue;
        }
        // ── Partial ────────────────────────────────────────────────────────────
        if (node.tag.startsWith('p.')) {
            const partialName = node.tag.slice(2);
            const partialResult = reader('_p/' + partialName + '.lml');
            if (!partialResult)
                throw new Error('Partial not found: _p/' + partialName + '.lml');
            const vAttr = node.attributes.find(a => a.name === 'v');
            const rawVars = vAttr?.value ? parseInlineVars(vAttr.value) : {};
            const varEntries = Object.entries(rawVars);
            const hasScript = partialResult.script.trim().length > 0;
            const hasVars = varEntries.length > 0;
            lines.push(indent + '__out+=await(async function(){');
            if (hasScript) {
                lines.push(indent + '  // _p/' + partialName + '.lml script section');
                for (const line of partialResult.script.split('\n')) {
                    lines.push(indent + '  ' + line);
                }
            }
            if (hasVars) {
                const paramDestr = '{' + varEntries.map(([k]) => k).join(',') + '}';
                const argObj = '{' + varEntries.map(([k, v]) => k + ':(' + v + ')').join(',') + '}';
                lines.push(indent + '  return await(async function(' + paramDestr + '){');
                lines.push(indent + '    var __out="";');
                lines.push(emitNodesJsCode(partialResult.nodes, reader, indent + '    ', '""', counter));
                lines.push(indent + '    return __out;');
                lines.push(indent + '  })(' + argObj + ');');
            }
            else {
                lines.push(indent + '  var __out="";');
                lines.push(emitNodesJsCode(partialResult.nodes, reader, indent + '  ', '""', counter));
                lines.push(indent + '  return __out;');
            }
            lines.push(indent + '})();');
            continue;
        }
        // ── Regular element ────────────────────────────────────────────────────
        const openExpr = openTagToJsExpr(node.tag, node.attributes);
        if (VOID_ELEMENTS.has(node.tag)) {
            lines.push(indent + '__out+=' + openExpr + ';');
            continue;
        }
        lines.push(indent + '__out+=' + openExpr + ';');
        if (node.children.length > 0) {
            lines.push(emitNodesJsCode(node.children, reader, indent, childrenVar, counter));
        }
        lines.push(indent + '__out+=' + JSON.stringify('</' + node.tag + '>') + ';');
    }
    return lines.join('\n');
}
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
export function compilePageToJs(page, reader) {
    const { script, nodes } = page;
    const counter = { n: 0 };
    // ── Extract document structure ──────────────────────────────────────────
    const docRootTags = ['html', 'lml'];
    const rootNode = (nodes.length === 1 &&
        nodes[0].kind === 'element' &&
        docRootTags.includes(nodes[0].tag)) ? nodes[0] : null;
    let titleExpr = 'null';
    let headNodesCode = '[]';
    let bodyNodes = nodes;
    if (rootNode) {
        const headEl = rootNode.children.find((n) => n.kind === 'element' && n.tag === 'head');
        const bodyEl = rootNode.children.find((n) => n.kind === 'element' && n.tag === 'body');
        bodyNodes = bodyEl
            ? bodyEl.children
            : rootNode.children.filter(n => !(n.kind === 'element' && ['head', 'body'].includes(n.tag)));
        if (headEl) {
            const titleEl = headEl.children.find((n) => n.kind === 'element' && n.tag === 'title');
            if (titleEl) {
                const tc = titleEl.children[0];
                if (tc && tc.kind === 'text') {
                    titleExpr = textToJsExprRaw(tc.content);
                }
            }
            const headChildren = headEl.children.filter(n => !(n.kind === 'element' && n.tag === 'title'));
            if (headChildren.length > 0) {
                headNodesCode = '[' + headChildren.map(headNodeToJsLiteral).join(',') + ']';
            }
        }
    }
    // ── Emit body code ──────────────────────────────────────────────────────
    const bodyCode = emitNodesJsCode(bodyNodes, reader, '  ', '""', counter);
    // ── Assemble module ─────────────────────────────────────────────────────
    const lines = [
        '/* compiled by lmlc */',
        'export default async function(){',
        "  function __esc(v){var s=v==null?'':String(v);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}",
        // Use \" instead of " inside the replace string to avoid issues with the outer quotes
        "  function __escAttr(v){var s=v==null?'':String(v);return s.replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;');}",
        "  function __str(v){return v==null?'':String(v);}",
    ];
    if (script.trim()) {
        lines.push('  // --- script section ---');
        for (const line of script.split('\n')) {
            lines.push('  ' + line);
        }
        lines.push('  // --- end script ---');
    }
    lines.push('  var __title=' + titleExpr + ';');
    lines.push('  var __headNodes=' + headNodesCode + ';');
    lines.push('  var __out="";');
    if (bodyCode.trim())
        lines.push(bodyCode);
    lines.push('  return{title:__title,headNodes:__headNodes,html:__out};');
    lines.push('}');
    return lines.join('\n');
}
//# sourceMappingURL=codegen.js.map