/**
 * Parse and write .env files for Project Env import/download.
 *
 * Handles what real .env files contain: comments, blank lines, `export KEY=`,
 * single quotes (literal), double quotes (\n \r \t \" \\ escapes, may span lines,
 * e.g. private keys), and unquoted values with trailing ` # comments`.
 * Errors name the line number only, never the line's contents (it may be a secret).
 */
export interface EnvEntry { key: string; value: string }
export interface ParseResult { entries: EnvEntry[]; errors: { line: number; message: string }[] }

export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export const MAX_KEY_LEN = 200;

export function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LEN && KEY_RE.test(key);
}

function unescapeDouble(s: string): string {
  return s.replace(/\\([nrt"\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' } as Record<string, string>)[c]);
}

export function parseEnv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = new Map<string, string>();
  const errors: ParseResult['errors'] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const m = line.match(/^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/);
    if (!m) { errors.push({ line: lineNo, message: 'Not a KEY=value line' }); continue; }
    const key = m[1];
    if (!isValidKey(key)) { errors.push({ line: lineNo, message: 'Invalid key name' }); continue; }
    let rest = m[2];
    let value: string;

    if (rest.startsWith('"')) {
      // Double-quoted: find the closing unescaped quote, possibly on a later line.
      let buf = rest.slice(1);
      let j = i;
      let close = findClosingQuote(buf);
      while (close < 0 && j + 1 < lines.length) {
        j++;
        buf += '\n' + lines[j];
        close = findClosingQuote(buf);
      }
      if (close < 0) { errors.push({ line: lineNo, message: 'Unclosed double quote' }); continue; }
      value = unescapeDouble(buf.slice(0, close));
      i = j;
    } else if (rest.startsWith("'")) {
      const close = rest.indexOf("'", 1);
      if (close < 0) { errors.push({ line: lineNo, message: 'Unclosed single quote' }); continue; }
      value = rest.slice(1, close);
    } else {
      const hash = rest.search(/\s#/);
      value = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
    }
    out.delete(key); // last one wins, keeping file order of the final occurrence
    out.set(key, value);
  }
  return { entries: Array.from(out, ([key, value]) => ({ key, value })), errors };
}

function findClosingQuote(s: string): number {
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '"') return k;
  }
  return -1;
}

/** Write entries as a .env file. Plain values stay bare; anything else is double-quoted. */
export function serializeEnv(entries: EnvEntry[], header?: string): string {
  const body = entries.map(({ key, value }) => {
    if (/^[A-Za-z0-9_./:@+,=-]*$/.test(value)) return `${key}=${value}`;
    const esc = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return `${key}="${esc}"`;
  });
  return (header ? header.split('\n').map((l) => `# ${l}`).join('\n') + '\n' : '') + body.join('\n') + '\n';
}
