// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Matches a valid HTML/LML tag name.
 * Plain names:  `div`, `my-component`
 * Namespaced:   `t.layout` (template), `p.card` (partial)
 */
const TAG_NAME_RE = /^(?:[tp]\.[a-zA-Z][a-zA-Z0-9-]*|[a-zA-Z][a-zA-Z0-9-]*)$/;
/**
 * Attribute syntax:
 *   name                   → boolean attribute
 *   name="value"           → double-quoted value
 *   name='value'           → single-quoted value
 *   name=value             → unquoted value (no whitespace)
 *
 * Attribute names follow the XML/HTML rules and may include colons and hyphens
 * for namespaces and data-* attributes.
 */
const ATTR_RE = /^(?<name>[a-zA-Z_][a-zA-Z0-9_:-]*)(?:=(?:"(?<dq>[^"]*)"|'(?<sq>[^']*)'|(?<uq>\S+)))?$/;
/** Matches a full single-line HTML comment */
const COMMENT_RE = /^\s*<!--.*-->\s*$/;
/** Matches the opening line of a multi-line block attribute: `name={` */
const BLOCK_ATTR_RE = /^([a-zA-Z_][a-zA-Z0-9_:-]*)=\{$/;
export class ParseError extends Error {
    line;
    constructor(message, line) {
        super(`Line ${line}: ${message}`);
        this.line = line;
        this.name = 'ParseError';
    }
}
function prepareLines(source) {
    return source.split('\n').map((raw, idx) => {
        const trimmed = raw.trim();
        let indent = 0;
        let hasLeadingTab = false;
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] === ' ')
                indent++;
            else if (raw[i] === '\t') {
                indent += 2;
                hasLeadingTab = true;
            } // treat tab as 2 spaces
            else
                break;
        }
        return { raw, trimmed, indent, lineNum: idx + 1, hasLeadingTab };
    });
}
function isBlankOrComment(line) {
    return line.trimmed === '' || COMMENT_RE.test(line.raw);
}
function skip(lines, i) {
    while (i < lines.length && isBlankOrComment(lines[i]))
        i++;
    return i;
}
// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------
function parseAttribute(raw, lineNum) {
    const m = ATTR_RE.exec(raw);
    if (!m || !m.groups) {
        throw new ParseError(`Invalid attribute syntax: ${JSON.stringify(raw)}`, lineNum);
    }
    const { name, dq, sq, uq } = m.groups;
    // Use ?? carefully: empty string ("") is a valid value, only undefined means absent
    const value = dq !== undefined ? dq :
        sq !== undefined ? sq :
            uq !== undefined ? uq :
                null;
    return { name: name, value };
}
// ---------------------------------------------------------------------------
// Recursive descent parser
// ---------------------------------------------------------------------------
/**
 * Parses a single element starting at `lines[start]`.
 * `baseIndent` is the indentation of the opening `<tagname` line.
 *
 * Returns the parsed ElementNode and the index of the next unprocessed line.
 */
function parseElement(lines, start, baseIndent) {
    const openLine = lines[start];
    if (!openLine.trimmed.startsWith('<')) {
        throw new ParseError(`Expected '<tagname', got ${JSON.stringify(openLine.trimmed)}`, openLine.lineNum);
    }
    const tag = openLine.trimmed.slice(1);
    if (!TAG_NAME_RE.test(tag)) {
        throw new ParseError(`Invalid tag name: ${JSON.stringify(tag)}`, openLine.lineNum);
    }
    let i = start + 1;
    const attributes = [];
    const children = [];
    let childIndent = null;
    let inChildren = false;
    while (true) {
        i = skip(lines, i);
        if (i >= lines.length) {
            throw new ParseError(`Unexpected end of input — missing '>' to close <${tag}>`, openLine.lineNum);
        }
        const line = lines[i];
        if (line.indent === baseIndent) {
            // Same indent as the tag: either an attribute or the closing '>'
            if (line.trimmed === '>') {
                i++;
                break; // element successfully closed
            }
            if (inChildren) {
                throw new ParseError(`Expected '>' to close <${tag}>, got ${JSON.stringify(line.trimmed)}`, line.lineNum);
            }
            // Attribute line — either a multi-line block (`name={`) or a regular attribute
            if (line.hasLeadingTab) {
                console.warn(`[lml] Line ${line.lineNum}: attribute indented with a tab character — ` +
                    `use spaces only. This may cause unexpected parsing.`);
            }
            const blockM = BLOCK_ATTR_RE.exec(line.trimmed);
            if (blockM) {
                const name = blockM[1];
                i++;
                const parts = [];
                let closed = false;
                while (i < lines.length) {
                    const bl = lines[i];
                    if (bl.trimmed === '}') {
                        i++;
                        closed = true;
                        break;
                    }
                    if (bl.trimmed !== '')
                        parts.push(bl.trimmed);
                    i++;
                }
                if (!closed) {
                    throw new ParseError(`Unclosed block attribute '${name}={' — missing '}'`, line.lineNum);
                }
                attributes.push({ name, value: '{' + parts.join(' ') + '}' });
            }
            else {
                attributes.push(parseAttribute(line.trimmed, line.lineNum));
                i++;
            }
        }
        else if (line.indent > baseIndent) {
            // Deeper indent: child content
            inChildren = true;
            if (childIndent === null) {
                childIndent = line.indent;
            }
            if (line.indent !== childIndent) {
                throw new ParseError(`Inconsistent indentation inside <${tag}> — ` +
                    `expected ${childIndent} spaces but got ${line.indent}`, line.lineNum);
            }
            if (line.trimmed.startsWith('<')) {
                const [child, nextI] = parseElement(lines, i, childIndent);
                children.push(child);
                i = nextI;
            }
            else {
                // Plain text child
                children.push({ kind: 'text', content: line.trimmed, line: line.lineNum });
                i++;
            }
        }
        else {
            // Shallower indent — should not happen inside a well-formed element
            throw new ParseError(`Unexpected dedent inside <${tag}> at line ${line.lineNum}`, line.lineNum);
        }
    }
    return [
        { kind: 'element', tag, attributes, children, line: openLine.lineNum },
        i,
    ];
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Parses LML source text and returns the document AST.
 * Throws `ParseError` on any syntax problem.
 */
export function parse(source) {
    const lines = prepareLines(source);
    const document = [];
    let i = 0;
    while (true) {
        i = skip(lines, i);
        if (i >= lines.length)
            break;
        const line = lines[i];
        if (!line.trimmed.startsWith('<')) {
            throw new ParseError(`Unexpected content at top level: ${JSON.stringify(line.trimmed)}`, line.lineNum);
        }
        const [element, nextI] = parseElement(lines, i, line.indent);
        document.push(element);
        i = nextI;
    }
    return document;
}
// ---------------------------------------------------------------------------
// Script / LML splitter
// ---------------------------------------------------------------------------
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
export function splitScriptAndLml(source) {
    const lines = source.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '<lml>');
    if (sepIdx === -1)
        return { script: '', lml: source };
    return {
        script: lines.slice(0, sepIdx).join('\n'),
        lml: lines.slice(sepIdx + 1).join('\n'),
    };
}
//# sourceMappingURL=parser.js.map