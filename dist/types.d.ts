export interface Attribute {
    name: string;
    /** null means boolean/presence attribute (e.g. `disabled`) */
    value: string | null;
}
export interface ElementNode {
    kind: 'element';
    tag: string;
    attributes: Attribute[];
    children: ASTNode[];
    /** 1-based source line number */
    line: number;
}
export interface TextNode {
    kind: 'text';
    content: string;
    /** 1-based source line number */
    line: number;
}
export type ASTNode = ElementNode | TextNode;
/** Top-level list of root nodes (typically a single <html> element) */
export type Document = ASTNode[];
//# sourceMappingURL=types.d.ts.map