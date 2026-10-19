export interface XmlNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  readonly text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? whole;
  });

export const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function parseXml(source: string): XmlNode {
  let pos = 0;
  const fail = (message: string): never => {
    throw new Error(`Invalid XML at ${pos}: ${message}`);
  };
  const skipMisc = () => {
    for (;;) {
      while (/\s/.test(source[pos] ?? '')) pos++;
      if (source.startsWith('<?', pos)) pos = source.indexOf('?>', pos) + 2 || fail('unclosed declaration');
      else if (source.startsWith('<!--', pos)) pos = source.indexOf('-->', pos) + 3 || fail('unclosed comment');
      else if (source.startsWith('<!DOCTYPE', pos)) {
        let depth = 0;
        for (; pos < source.length; pos++) {
          if (source[pos] === '[') depth++;
          else if (source[pos] === ']') depth--;
          else if (source[pos] === '>' && depth === 0) break;
        }
        pos++;
      } else return;
    }
  };
  const element = (): XmlNode => {
    if (source[pos] !== '<') fail('expected an element');
    const head = /^<([\w:.-]+)/.exec(source.slice(pos, pos + 200)) ?? fail('bad tag');
    const name = head[1];
    pos += head[0].length;
    const attrs: Record<string, string> = {};
    for (;;) {
      while (/\s/.test(source[pos] ?? '')) pos++;
      if (source.startsWith('/>', pos)) {
        pos += 2;
        return { name, attrs, children: [], text: '' };
      }
      if (source[pos] === '>') {
        pos++;
        break;
      }
      const attr = /^([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(source.slice(pos)) ?? fail(`bad attribute in <${name}>`);
      attrs[attr[1]] = decode(attr[3] ?? attr[4]);
      pos += attr[0].length;
    }
    const children: XmlNode[] = [];
    let text = '';
    for (;;) {
      if (pos >= source.length) fail(`unclosed <${name}>`);
      if (source.startsWith('</', pos)) {
        const end = source.indexOf('>', pos);
        if (source.slice(pos + 2, end).trim() !== name) fail(`mismatched </${source.slice(pos + 2, end)}> for <${name}>`);
        pos = end + 1;
        return { name, attrs, children, text };
      }
      if (source.startsWith('<!--', pos)) pos = source.indexOf('-->', pos) + 3 || fail('unclosed comment');
      else if (source.startsWith('<![CDATA[', pos)) {
        const end = source.indexOf(']]>', pos);
        if (end < 0) fail('unclosed CDATA');
        text += source.slice(pos + 9, end);
        pos = end + 3;
      } else if (source.startsWith('<?', pos)) pos = source.indexOf('?>', pos) + 2 || fail('unclosed instruction');
      else if (source[pos] === '<') children.push(element());
      else {
        const next = source.indexOf('<', pos);
        const end = next < 0 ? source.length : next;
        text += decode(source.slice(pos, end));
        pos = end;
      }
    }
  };
  skipMisc();
  const root = element();
  skipMisc();
  if (pos < source.length) fail('content after the root element');
  return root;
}

export const child = (node: XmlNode, name: string) => node.children.find((c) => c.name === name) ?? null;

export const children = (node: XmlNode, name: string) => node.children.filter((c) => c.name === name);

export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export const textOf = (node: XmlNode): string => node.text + node.children.map(textOf).join('');

export function element(name: string, attrs: Record<string, string | number | null | undefined>, ...content: string[]): string {
  const list = Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`).join('');
  return content.length ? `<${name}${list}>${content.join('')}</${name}>` : `<${name}${list}/>`;
}
