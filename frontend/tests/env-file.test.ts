import { describe, expect, it } from 'vitest';
import { isValidKey, parseEnv, serializeEnv } from '@/lib/vault/env-file';

describe('parseEnv', () => {
  it('reads plain, quoted, exported and commented lines', () => {
    const { entries, errors } = parseEnv([
      '# comment',
      '',
      'PLAIN=abc123',
      'export EXPORTED=yes',
      'SPACED = padded  ',
      "SINGLE='a # not comment $X'",
      'DOUBLE="line1\\nline2 \\"q\\""',
      'INLINE=value # trailing comment',
      'URL=postgres://u:p@h:5432/db?ssl=true',
      'EMPTY=',
      'EQUALS=a=b=c',
    ].join('\n'));
    expect(errors).toEqual([]);
    expect(Object.fromEntries(entries.map((e) => [e.key, e.value]))).toEqual({
      PLAIN: 'abc123',
      EXPORTED: 'yes',
      SPACED: 'padded',
      SINGLE: 'a # not comment $X',
      DOUBLE: 'line1\nline2 "q"',
      INLINE: 'value',
      URL: 'postgres://u:p@h:5432/db?ssl=true',
      EMPTY: '',
      EQUALS: 'a=b=c',
    });
  });

  it('reads a multi-line double-quoted value (private keys)', () => {
    const { entries } = parseEnv('KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\nNEXT=1');
    expect(entries).toEqual([
      { key: 'KEY', value: '-----BEGIN KEY-----\nabc\n-----END KEY-----' },
      { key: 'NEXT', value: '1' },
    ]);
  });

  it('last duplicate wins; Windows line endings and BOM are fine', () => {
    const { entries } = parseEnv('﻿A=1\r\nB=2\r\nA=3\r\n');
    expect(entries).toEqual([{ key: 'B', value: '2' }, { key: 'A', value: '3' }]);
  });

  it('reports bad lines by number only, never their contents', () => {
    const { entries, errors } = parseEnv('GOOD=1\nthis is sk_live_secret\n9BAD=x\nOPEN="never closed');
    expect(entries).toEqual([{ key: 'GOOD', value: '1' }]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(JSON.stringify(errors)).not.toContain('sk_live_secret');
  });
});

describe('serializeEnv', () => {
  it('round-trips through parseEnv', () => {
    const entries = [
      { key: 'A', value: 'plain-value_1.2' },
      { key: 'B', value: 'has space and # hash' },
      { key: 'C', value: 'quote " and \\ backslash' },
      { key: 'D', value: 'multi\nline\tvalue' },
      { key: 'E', value: '' },
    ];
    const text = serializeEnv(entries, 'PRJ-0001 · Development');
    expect(text.startsWith('# PRJ-0001')).toBe(true);
    expect(parseEnv(text).entries).toEqual(entries);
  });
});

describe('isValidKey', () => {
  it('accepts usual names and rejects the rest', () => {
    for (const k of ['DATABASE_URL', '_X', 'next.public', 'a-b']) expect(isValidKey(k)).toBe(true);
    for (const k of ['', '1ABC', 'HAS SPACE', 'A=B', 'x'.repeat(201)]) expect(isValidKey(k)).toBe(false);
  });
});
