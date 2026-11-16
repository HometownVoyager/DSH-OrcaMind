/**
 * Shared XML utilities for the Office editor: the tag-stack well-formedness check every writer
 * runs on its output, and the structural indent used by `office_explode`.
 *
 * `assertWellFormedXml` used to be duplicated in `docx.ts` and `pptx.ts` (with `xlsx.ts` importing
 * the docx copy). It lives here now so the three engines and the package layer share one
 * implementation; `docx.ts` and `pptx.ts` still re-export it, because the regression suites import
 * it from there.
 *
 * The indenter is deliberately *not* a round-tripping serializer. Report §4.3 rules out chasing
 * lxml-style pretty printing (there is no namespace-preserving serializer on this side), so
 * {@link indentXml} only inserts line breaks and spaces **between** markup nodes and never
 * reorders, renames or drops anything. See its own doc comment for the two cases it refuses to
 * touch, which are the whole reason it is safe on `<w:t>`-bearing parts.
 *
 * @module dsh-office-editor/src/xml
 */

/** Default indent unit, matching the reference `explode.py`'s two spaces. */
const INDENT_UNIT = '  '

/**
 * A tag-stack well-formedness check for OOXML parts.
 *
 * This is deliberately not a general XML parser: it verifies that elements close in order and
 * that nothing sits outside the root, which is exactly the damage class string-surgery editing
 * produces. Comments, CDATA and DOCTYPE are stripped before tokenizing so their contents cannot
 * be mistaken for elements. Attribute values may contain `>` (escaped as `&gt;` by writers, but
 * tolerated here because the tokenizer consumes quoted runs as a unit).
 *
 * Merging this into one function reconciled three copies that had drifted: the docx and reader
 * versions accept a self-closing root (`<cp:coreProperties .../>` is a complete document, and is
 * what SheetJS writes for an empty `docProps/core.xml`), while the pptx copy rejected it. The
 * permissive rule is the correct one; `p0-regression.mjs` pins the accepted and rejected shapes.
 *
 * @param xml - one XML part.
 * @param partName - part name used in the error message.
 * @throws an Error naming the imbalance when the fragment is malformed.
 */
export function assertWellFormedXml(xml: string, partName: string): void {
  const cleaned = xml
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gu, ' ')
    .replace(/<!DOCTYPE[^>]*>/gu, ' ')
  const tokenRe = /<([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\/([A-Za-z_][\w.:-]*)\s*>|<\?[\s\S]*?\?>/gu
  const stack: string[] = []
  let rootClosed = false
  let cursor = 0
  for (let m = tokenRe.exec(cleaned); m !== null; m = tokenRe.exec(cleaned)) {
    const stray = cleaned.slice(cursor, m.index)
    cursor = m.index + m[0].length
    if (rootClosed) {
      // `stray` is always empty here (it was the token just consumed), so this only has to reject
      // a following *element* — a second root, which is exactly what a bad splice produces.
      if (m[1] !== undefined || m[4] !== undefined) {
        throw new Error(`${partName} 在根元素之后还有元素（偏移 ${m.index}），根元素只能有一个`)
      }
      continue
    }
    if (stack.length === 0) {
      if (stray.trim() !== '') throw new Error(`${partName} 在根元素之前有非法内容：${JSON.stringify(stray.slice(0, 60))}`)
      if (m[1] === undefined) continue
      // A self-closing root is a complete document (`<cp:coreProperties .../>` is what SheetJS
      // writes for an empty docProps/core.xml), so it closes the root like any other element.
      if (m[3] === '/') {
        rootClosed = true
        continue
      }
      stack.push(m[1])
      continue
    }
    if (m[4] !== undefined) {
      const open = stack.pop()
      if (open === undefined) throw new Error(`${partName} 在偏移 ${m.index} 处出现多余的 </${m[4]}>`)
      if (open !== m[4]) throw new Error(`${partName} 标签不匹配：<${open}> 被 </${m[4]}> 关闭（偏移 ${m.index}）`)
      if (stack.length === 0) rootClosed = true
      continue
    }
    if (m[1] === undefined) continue
    if (m[3] !== '/') stack.push(m[1])
  }
  const trailing = cleaned.slice(cursor).trim()
  if (trailing !== '') throw new Error(`${partName} 在根元素之后有非法内容：${JSON.stringify(trailing.slice(0, 60))}`)
  if (stack.length > 0) throw new Error(`${partName} 有未闭合的标签：<${stack[stack.length - 1]}>（共 ${stack.length} 个）`)
}

/** One parsed node: markup kept verbatim, or a container whose body needs classifying. */
type XmlNode =
  | { kind: 'verbatim'; text: string }
  | { kind: 'container'; open: string; close: string; children: XmlNode[]; mixed: boolean }

/**
 * Tokenize a well-formed XML document into a node tree, or return null when the input is not
 * tokenizable (a caller then falls back to verbatim output rather than guessing).
 *
 * The parser assumes well-formedness and bails out on any mismatch instead of repairing it — the
 * indenter runs on parts that {@link assertWellFormedXml} has already accepted.
 *
 * @returns the untouched prolog and the root node, or null when the input does not tokenize.
 */
function parseXmlTree(xml: string): { prolog: string; root: XmlNode } | null {
  const tokenRe = /<([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\/([A-Za-z_][\w.:-]*)\s*>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>/gu
  interface OpenFrame { open: string; name: string; children: XmlNode[] }
  const stack: OpenFrame[] = []
  let root: XmlNode | null = null
  let prolog = ''
  let cursor = 0
  /** Append a text run to the deepest open element. */
  const pushText = (text: string): void => {
    if (text === '') return
    if (stack.length === 0) return
    stack[stack.length - 1].children.push({ kind: 'verbatim', text })
  }
  for (let m = tokenRe.exec(xml); m !== null; m = tokenRe.exec(xml)) {
    if (root === null && stack.length === 0 && m[1] !== undefined) {
      // The root's opening tag: everything before it is the prolog (declaration, comments,
      // whitespace) and is carried through verbatim — rebuilding it would drop the declaration,
      // which is what the first version of this function did.
      prolog = xml.slice(0, m.index)
    }
    pushText(xml.slice(cursor, m.index))
    cursor = m.index + m[0].length
    if (m[1] !== undefined) {
      if (m[3] === '/') {
        const selfClosing = { kind: 'verbatim' as const, text: m[0] }
        if (stack.length === 0) root = selfClosing
        else stack[stack.length - 1].children.push(selfClosing)
        continue
      }
      stack.push({ open: m[0], name: m[1], children: [] })
      continue
    }
    if (m[4] !== undefined) {
      const frame = stack.pop()
      if (frame === undefined || frame.name !== m[4]) return null
      const node: XmlNode = { kind: 'container', open: frame.open, close: m[0], children: frame.children, mixed: false }
      if (stack.length === 0) root = node
      else stack[stack.length - 1].children.push(node)
      continue
    }
    // Processing instruction, comment, CDATA, DOCTYPE: keep the bytes exactly as they were.
    pushText(m[0])
  }
  pushText(xml.slice(cursor))
  if (root === null || stack.length > 0) return null
  return { prolog, root }
}

/**
 * Does a container hold text next to its elements (or a CDATA/comment node it cannot re-flow)?
 *
 * Both cases make whitespace *content*, so the node is emitted verbatim. This is the check that
 * keeps the indenter off `<w:t>总则</w:t>` (a text-only leaf) and off a `<w:p>` whose body is
 * `text<w:br/>text` — the run-level shape where an inserted newline would show up in Word.
 */
function isMixedContent(children: XmlNode[]): boolean {
  for (const child of children) {
    if (child.kind !== 'verbatim') continue
    if (child.text.startsWith('<')) return true
    if (child.text.trim() !== '') return true
  }
  return false
}

/**
 * Render one node at the given depth.
 *
 * An element whose children are *only* whitespace text (officially empty content) is emitted as a
 * single line: `trim()` makes leading and trailing whitespace insignificant there, so collapsing it
 * is legal and keeps parts like `<w:jc .../>` on one line.
 */
function renderNode(node: XmlNode, depth: number): string {
  if (node.kind === 'verbatim') return node.text
  const pad = INDENT_UNIT.repeat(depth)
  const inner = INDENT_UNIT.repeat(depth + 1)
  if (node.children.length === 0) return `${node.open}${node.close}`
  if (isMixedContent(node.children)) {
    return `${node.open}${node.children.map((child) => renderNode(child, depth + 1)).join('')}${node.close}`
  }
  const kept = node.children.filter((child) => child.kind === 'container' || child.text.trim() !== '')
  if (kept.length === 0) return `${node.open}${node.close}`
  const body = kept.map((child) => `\n${inner}${renderNode(child, depth + 1)}`).join('')
  return `${node.open}${body}\n${pad}${node.close}`
}

/**
 * Indent an XML part for human reading, changing **only** inter-node whitespace.
 *
 * Round-trip safety rests on two guards rather than on trusting the XML spec:
 *
 * - a container holding any non-whitespace text, CDATA or comment next to its child elements is
 *   emitted byte-for-byte (`mixed`), so `<w:p>text<w:br/>text</w:p>` keeps the exact text nodes
 *   Word wrote;
 * - a part that does not tokenize comes back unchanged.
 *
 * The prolog (XML declaration, leading comments) is carried through as the exact source substring.
 * Everything else gets a line break and two spaces per level between elements, and a trailing
 * newline. Attributes, namespace declarations, entity references and the element order are all
 * preserved, because the markup is carried through as substrings and never rebuilt.
 *
 * @param xml - one XML part.
 * @returns the indented part; the input unchanged when it cannot be tokenized.
 */
export function indentXml(xml: string): string {
  const parsed = parseXmlTree(xml)
  if (parsed === null) return xml
  return `${parsed.prolog}${renderNode(parsed.root, 0)}\n`
}
