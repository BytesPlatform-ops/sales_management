import { afterEach, describe, expect, it } from 'vitest';
import { isInlineSafe, kindOf, maxUploadBytes, normalizeMime, safeFileName } from '@/lib/media/rules';

const saved = process.env.MEDIA_MAX_MB;
afterEach(() => { process.env.MEDIA_MAX_MB = saved; });

describe('media rules', () => {
  it('limits uploads to 50 MB by default, configurable', () => {
    delete process.env.MEDIA_MAX_MB;
    expect(maxUploadBytes()).toBe(50 * 1024 * 1024);
    process.env.MEDIA_MAX_MB = '10';
    expect(maxUploadBytes()).toBe(10 * 1024 * 1024);
    process.env.MEDIA_MAX_MB = 'nonsense';
    expect(maxUploadBytes()).toBe(50 * 1024 * 1024);
  });

  it('previews images, video, audio and PDF inline', () => {
    expect(kindOf('image/png')).toBe('image');
    expect(kindOf('video/mp4')).toBe('video');
    expect(kindOf('audio/mpeg')).toBe('audio');
    expect(kindOf('application/pdf')).toBe('pdf');
    expect(kindOf('application/zip')).toBe('file');
  });

  it('never serves script-capable files inline', () => {
    for (const m of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'application/javascript', 'text/javascript',
      'application/xml', 'text/xml', 'application/x-msdownload', 'application/octet-stream']) {
      expect(isInlineSafe(m)).toBe(false);
    }
  });

  it('cleans file names (no paths, no odd characters)', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\Report Q3 (final).pdf')).toBe('Report-Q3-final.pdf');
    expect(safeFileName('.htaccess')).toBe('htaccess');
    expect(safeFileName('')).toBe('file');
  });

  it('normalises declared mime types', () => {
    expect(normalizeMime('IMAGE/PNG')).toBe('image/png');
    expect(normalizeMime('text/html; charset=utf-8')).toBe('text/html');
    expect(isInlineSafe(normalizeMime('text/html; charset=utf-8'))).toBe(false);
    expect(normalizeMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeMime(undefined)).toBe('application/octet-stream');
  });
});
