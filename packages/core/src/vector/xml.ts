/**
 * A strict reader for the XML that SVG files are written in (D127 §4). It's the security
 * boundary for SVG import, so it does far less than a general XML parser, on purpose:
 *
 * - **No DOCTYPE and no entity declarations**: refused outright, with no way to define an
 *   entity, so nothing can expand ("billion laughs") or point at a file or a URL (XXE).
 * - Only the five built-in entities (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;`) and numeric
 *   character references are decoded; any other `&name;` is an error.
 * - Comments, processing instructions (`<?xml …?>`) and CDATA are skipped; text between tags
 *   is ignored (the importer reads shapes, not text).
 * - Size, element count and nesting depth are capped.
 *
 * Pure, no DOM: it runs on the server (MCP), in the editor (paste) and in tests alike.
 */

export const MAX_SVG_LENGTH = 2_000_000;
export const MAX_SVG_ELEMENTS = 20_000;
export const MAX_SVG_DEPTH = 64;

export interface XmlElement {
  /** As written, prefix included (`svg`, `sodipodi:namedview`). */
  name: string;
  /** Attribute values, entities decoded. The first of a repeated name wins. */
  attrs: Map<string, string>;
  children: XmlElement[];
}

export type XmlParse =
  | { ok: true; root: XmlElement }
  | {
      ok: false;
      /** What's wrong and how to fix it, for a person or an agent. */
      message: string;
      /** Character index of the problem. */
      at: number;
    };

class XmlError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const SPACE = /\s*/y;
const ATTR_NAME = /[^\s=/>"'<]+/y;

/** An element's name without its namespace prefix: `svg:path` → `path`. */
export const localName = (name: string) => name.slice(name.indexOf(":") + 1);

const RAW_TEXT = new Set(["script", "style"]);

const PREDEFINED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode the built-in and numeric entities; anything else was never declared, so it's refused. */
function decode(value: string, at: number): string {
  return value.replace(/&([^;\s&]*);?/g, (whole, ref: string) => {
    if (!whole.endsWith(";"))
      throw new XmlError("A bare '&' in an attribute: write it as &amp;", at);
    const named = PREDEFINED[ref];
    if (named !== undefined) return named;
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(ref);
    if (numeric) {
      const code = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        return String.fromCodePoint(code);
      }
    }
    throw new XmlError(
      `The entity "&${ref};" isn't allowed: only &amp; &lt; &gt; &quot; &apos; and numeric references`,
      at,
    );
  });
}

export function parseXml(text: string): XmlParse {
  if (text.length > MAX_SVG_LENGTH) {
    return {
      ok: false,
      message: `The SVG is ${text.length} characters; at most ${MAX_SVG_LENGTH} are accepted. Simplify it (fewer points) or export it smaller.`,
      at: MAX_SVG_LENGTH,
    };
  }
  try {
    return { ok: true, root: read(text) };
  } catch (error) {
    if (error instanceof XmlError) return { ok: false, message: error.message, at: error.at };
    throw error;
  }
}

function read(text: string): XmlElement {
  let i = 0;
  let count = 0;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  /** Skip past `end`, or fail with `what` if it never comes. */
  const skipTo = (end: string, what: string) => {
    const close = text.indexOf(end, i);
    if (close < 0) throw new XmlError(`${what} is never closed (no "${end}")`, i);
    i = close + end.length;
  };
  const match = (re: RegExp): string | null => {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break; // trailing text
    i = lt;
    if (text.startsWith("<!--", i)) {
      skipTo("-->", "A comment");
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      skipTo("]]>", "A CDATA section");
      continue;
    }
    if (text.startsWith("<!", i)) {
      throw new XmlError(
        "SVGs with a <!DOCTYPE> or <!ENTITY> aren't accepted (entities can't be expanded safely). Export the SVG without a DOCTYPE; design tools do by default.",
        i,
      );
    }
    if (text.startsWith("<?", i)) {
      skipTo("?>", "A processing instruction");
      continue;
    }
    if (text.startsWith("</", i)) {
      const at = i;
      i += 2;
      const name = match(NAME);
      match(SPACE);
      if (!name || text[i] !== ">") throw new XmlError("A closing tag is malformed", at);
      i++;
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new XmlError(
          open
            ? `</${name}> closes <${open.name}>: the tags don't match`
            : `</${name}> closes nothing`,
          at,
        );
      }
      continue;
    }

    // An opening tag.
    const at = i;
    i++;
    const name = match(NAME);
    if (!name) throw new XmlError("A '<' that doesn't start a tag: write it as &lt;", at);
    if (root && stack.length === 0) {
      throw new XmlError(`<${name}> comes after the root element ends: an SVG has one root`, at);
    }
    if (++count > MAX_SVG_ELEMENTS) {
      throw new XmlError(`More than ${MAX_SVG_ELEMENTS} elements: simplify the SVG`, at);
    }
    if (stack.length >= MAX_SVG_DEPTH) {
      throw new XmlError(`Nested more than ${MAX_SVG_DEPTH} levels deep`, at);
    }
    const element: XmlElement = { name, attrs: new Map(), children: [] };
    let selfClosing = false;
    for (;;) {
      const spaced = (match(SPACE) ?? "").length > 0;
      if (text.startsWith("/>", i)) {
        i += 2;
        selfClosing = true;
        break;
      }
      if (text[i] === ">") {
        i++;
        break;
      }
      if (i >= text.length) throw new XmlError(`<${name}> is never closed`, at);
      if (!spaced) throw new XmlError(`<${name}> has a malformed attribute`, i);
      const attrAt = i;
      const attr = match(ATTR_NAME);
      if (!attr) throw new XmlError(`<${name}> has a malformed attribute`, i);
      match(SPACE);
      if (text[i] !== "=") throw new XmlError(`The attribute "${attr}" has no value`, attrAt);
      i++;
      match(SPACE);
      const quote = text[i];
      if (quote !== '"' && quote !== "'") {
        throw new XmlError(`The value of "${attr}" isn't in quotes`, i);
      }
      const end = text.indexOf(quote, i + 1);
      if (end < 0) throw new XmlError(`The value of "${attr}" is never closed`, i);
      const raw = text.slice(i + 1, end);
      if (raw.includes("<")) throw new XmlError(`The value of "${attr}" contains '<'`, i);
      i = end + 1;
      if (!element.attrs.has(attr)) element.attrs.set(attr, decode(raw, attrAt));
    }
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else root = element;
    if (!selfClosing) {
      stack.push(element);
      // Script and style bodies are raw text (a `<` in `if (a<b)` isn't a tag): skip to their
      // closing tag. The importer leaves both out; this only keeps them from failing the file.
      if (RAW_TEXT.has(localName(name))) {
        const close = text.indexOf(`</${name}`, i);
        if (close < 0) throw new XmlError(`<${name}> is never closed`, at);
        i = close;
      }
    }
  }

  const open = stack.at(-1);
  if (open) throw new XmlError(`<${open.name}> is never closed`, text.length);
  if (!root) throw new XmlError("No SVG in the text: it should start with <svg", 0);
  return root;
}
