/**
 * A tiny XML well-formedness check for the tests: balanced tags, quoted attributes, no duplicate attributes,
 * valid entities, one root element. Enough to catch a broken template string in an avatar or in the rig.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
}

export interface XmlReport {
  root: string;
  elements: XmlElement[];
  /** Every id="…" in document order (duplicates kept, so callers can check them). */
  ids: string[];
}

const NAME = /^[A-Za-z_][\w.:-]*$/;
const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;

function checkText(text: string, where: string): void {
  if (text.includes('<')) throw new Error(`Stray "<" in ${where}`);
  if (text.replace(ENTITY, '').includes('&')) throw new Error(`Bad entity in ${where}`);
}

function parseAttrs(src: string, tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /\s*([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`Bad attribute syntax in <${tag}>: ${src.slice(i, i + 30)}`);
    const name = m[1] ?? '';
    const value = m[3] ?? m[4] ?? '';
    if (!NAME.test(name)) throw new Error(`Bad attribute name "${name}" in <${tag}>`);
    if (name in attrs) throw new Error(`Duplicate attribute "${name}" in <${tag}>`);
    checkText(value, `attribute ${name} of <${tag}>`);
    attrs[name] = value;
    i = re.lastIndex;
  }
  return attrs;
}

/** Throws with a reason if `xml` is not well-formed. */
export function checkXml(xml: string): XmlReport {
  const stack: string[] = [];
  const elements: XmlElement[] = [];
  const ids: string[] = [];
  let root = '';
  let closedRoot = false;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = xml.slice(i, lt === -1 ? xml.length : lt);
    if (text.trim() && stack.length === 0) throw new Error(`Text outside the root: ${text.slice(0, 30)}`);
    checkText(text, 'text');
    if (lt === -1) break;
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) throw new Error('Unclosed comment');
      i = end + 3;
      continue;
    }
    const gt = xml.indexOf('>', lt);
    if (gt === -1) throw new Error('Unclosed tag');
    const body = xml.slice(lt + 1, gt);
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      const open = stack.pop();
      if (open !== name) throw new Error(`</${name}> closes <${open ?? 'nothing'}>`);
      if (stack.length === 0) closedRoot = true;
    } else {
      const selfClosing = body.endsWith('/');
      const inner = selfClosing ? body.slice(0, -1) : body;
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
      const name = m?.[1] ?? '';
      if (!NAME.test(name)) throw new Error(`Bad tag name "${name}"`);
      if (stack.length === 0) {
        if (closedRoot || root) throw new Error('More than one root element');
        root = name;
      }
      const attrs = parseAttrs(m?.[2] ?? '', name);
      elements.push({ name, attrs });
      if (attrs.id !== undefined) ids.push(attrs.id);
      if (selfClosing) {
        if (stack.length === 0) closedRoot = true;
      } else stack.push(name);
    }
    i = gt + 1;
  }
  if (stack.length) throw new Error(`Unclosed <${stack.join('>, <')}>`);
  if (!root) throw new Error('No root element');
  return { root, elements, ids };
}

export interface XmlNode extends XmlElement {
  children: XmlNode[];
}

/** The element tree of `xml` (well-formed: checkXml throws otherwise). Text and comments are left out. */
export function xmlTree(xml: string): XmlNode {
  checkXml(xml);
  const top: XmlNode = { name: '', attrs: {}, children: [] };
  const stack: XmlNode[] = [top];
  for (const m of xml.matchAll(/<!--[\s\S]*?-->|<(\/?)([^\s/>]+)([^>]*?)(\/?)>/g)) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      stack.pop();
      continue;
    }
    const name = m[2] ?? '';
    const node: XmlNode = { name, attrs: parseAttrs(m[3] ?? '', name), children: [] };
    stack[stack.length - 1]?.children.push(node);
    if (!m[4]) stack.push(node);
  }
  const root = top.children[0];
  if (!root) throw new Error('No root element');
  return root;
}

/** Ids that appear more than once. */
export function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}
