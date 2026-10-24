/**
 * Website-scan helper (E.8 / C3.1). Deterministic checks first, then an
 * optional AI summary. Server-side fetch, 5 s timeout, cached 7 days per URL.
 * It complements the rep's own 30-second look — it doesn't replace it.
 */
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { query, queryOne } from '@/lib/db';
import { chatJSON, AiUnavailableError, STANDARD_MODE_MESSAGE } from './ai';
import type { Flag } from './classify';

export interface ScanCheck {
  id: string;
  label: string;          // H.3 checklist item
  status: 'ok' | 'issue' | 'unknown';
  detail: string;
  say: string | null;     // C3.1 "what you can say (as a question)"
}

export interface ScanResult {
  url: string;
  final_url: string | null;
  reachable: boolean;
  load_ms: number | null;
  page_kb: number | null;
  generator: string | null;
  checks: ScanCheck[];
  flags: Flag[];
  summary_lines: string[];
  suggested_question: string;
  ai_used: boolean;
  ai_message: string | null;
  cached: boolean;
  scanned_at: string;
}

const TIMEOUT_MS = 5000;
const CACHE_DAYS = 7;
const CURRENT_YEAR = new Date().getFullYear();

const SAY = {
  ssl: "I noticed Chrome flags your site as 'Not secure.' Has anyone mentioned that to you?",
  copyright: 'Looks like the site was last refreshed a few years back. Is that on your list?',
  mobile: "On a phone your site's a bit hard to read. Do primes ever look you up on mobile?",
  capability: 'When a CO or prime looks you up, where do they find your capability statement?',
  social: 'Do you do anything on social, or is that not a priority?',
  blog: 'Is the site bringing in any private-sector work right now?',
  template: 'Did someone build it for you, or was it a template?',
  speed: 'It took a while to load on my end. Has that come up before?',
  contact: 'How do new customers usually reach you, phone or email?',
  nosite: "I couldn't find a website for you. Is that intentional, or just hasn't been a priority?",
};

export function normalizeUrl(input: string): string | null {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function timedFetch(url: string) {
  const started = Date.now();
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BytesTrainingScan/1.0)', Accept: 'text/html' },
  });
  const html = await res.text();
  return { res, html, ms: Date.now() - started };
}

async function runChecks(url: string): Promise<Omit<ScanResult, 'summary_lines' | 'suggested_question' | 'ai_used' | 'ai_message' | 'cached' | 'scanned_at'>> {
  const httpsUrl = url.replace(/^http:\/\//i, 'https://');
  let fetched: Awaited<ReturnType<typeof timedFetch>> | null = null;
  let sslOk = false;
  let sslDetail = '';

  try {
    fetched = await timedFetch(httpsUrl);
    sslOk = fetched.res.url.startsWith('https://');
    sslDetail = sslOk ? 'Padlock / https works' : 'Redirects away from https';
  } catch (err: any) {
    const code = err?.cause?.code || err?.code || '';
    sslDetail = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(String(code)) ? 'Certificate problem — browsers show "Not secure"' : 'No working https';
    try {
      fetched = await timedFetch(httpsUrl.replace(/^https:\/\//i, 'http://'));
      sslOk = fetched.res.url.startsWith('https://');
      if (sslOk) sslDetail = 'http redirects to https';
    } catch {
      fetched = null;
    }
  }

  if (!fetched || fetched.res.status >= 400) {
    return {
      url, final_url: fetched?.res.url ?? null, reachable: false, load_ms: fetched?.ms ?? null, page_kb: null, generator: null,
      flags: ['no_site'],
      checks: [{ id: 'no_site', label: 'No site at all', status: 'issue', detail: fetched ? `HTTP ${fetched.res.status}` : 'Site did not load (dead, parked or blocked)', say: SAY.nosite }],
    };
  }

  const { html, ms, res } = fetched;
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');
  const lower = html.toLowerCase();
  const flags: Flag[] = [];
  const checks: ScanCheck[] = [];
  const push = (c: ScanCheck, flag?: Flag) => {
    checks.push(c);
    if (c.status === 'issue' && flag) flags.push(flag);
  };

  push({ id: 'ssl', label: 'Padlock / https', status: sslOk ? 'ok' : 'issue', detail: sslDetail, say: sslOk ? null : SAY.ssl }, 'no_ssl');

  const years = Array.from(text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)).map((m) => Number(m[1]));
  const year = years.length ? Math.max(...years) : null;
  push({
    id: 'copyright', label: '© year',
    status: year === null ? 'unknown' : year <= CURRENT_YEAR - 5 || year <= 2021 ? 'issue' : 'ok',
    detail: year === null ? 'No © year found' : `© ${year}`,
    say: year !== null && (year <= 2021 || year <= CURRENT_YEAR - 5) ? SAY.copyright : null,
  }, 'old_copyright');

  const viewport = $('meta[name="viewport"]').length > 0;
  push({ id: 'mobile', label: 'Mobile-friendly', status: viewport ? 'ok' : 'issue', detail: viewport ? 'Has a mobile viewport tag' : 'No mobile viewport tag — likely tiny text on phones', say: viewport ? null : SAY.mobile }, 'not_mobile');

  const cap = /capabilit(y|ies) statement|naics|cage code|\bcage\b|uei|duns|8\(a\)|hubzone|sdvosb|wosb|gsa schedule/i.test(text);
  push({ id: 'capability', label: 'Capability statement / NAICS / CAGE / certifications', status: cap ? 'ok' : 'issue', detail: cap ? 'Mentions capability statement / codes / certifications' : 'No capability statement, NAICS, CAGE or certifications found', say: cap ? null : SAY.capability }, 'no_capability_statement');

  const social = /facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com\/|youtube\.com|tiktok\.com/i.test(lower);
  push({ id: 'social', label: 'Social links & last post', status: social ? 'ok' : 'issue', detail: social ? 'Has social links (check when they last posted)' : 'No social links', say: social ? null : SAY.social }, 'no_social');

  const blog = $('a').toArray().some((a) => /blog|news|projects|portfolio|case stud|gallery/i.test(`${$(a).attr('href') || ''} ${$(a).text()}`));
  push({ id: 'blog', label: 'Blog / news / projects', status: blog ? 'ok' : 'issue', detail: blog ? 'Has blog/news/projects pages' : 'No blog, news or projects pages', say: blog ? null : SAY.blog }, 'no_blog');

  const generator = $('meta[name="generator"]').attr('content') || (lower.includes('wp-content') ? 'WordPress' : lower.includes('wix.com') ? 'Wix' : lower.includes('squarespace') ? 'Squarespace' : null);
  const templateLook = /lorem ipsum|just another wordpress site|sample page|hello world/i.test(text) || $('img').toArray().some((img) => /shutterstock|istock|placeholder|stock-photo/i.test($(img).attr('src') || ''));
  push({ id: 'template', label: 'Template / stock look', status: templateLook ? 'issue' : 'unknown', detail: templateLook ? 'Placeholder text or stock images found' : `Built with ${generator || 'unknown platform'} — judge the look yourself`, say: templateLook ? SAY.template : null }, 'template_look');

  const kb = Math.round(Buffer.byteLength(html) / 1024);
  const slow = ms > 3000;
  push({ id: 'speed', label: 'Load speed', status: slow ? 'issue' : 'ok', detail: `Loaded in ${(ms / 1000).toFixed(1)} s (${kb} KB HTML)`, say: slow ? SAY.speed : null }, 'slow_load');

  const form = $('form').length > 0;
  const tel = $('a[href^="tel:"]').length > 0;
  const freeMail = /@(gmail|yahoo|hotmail|aol|outlook)\.com/i.test(text);
  const contactOk = (form || tel) && !freeMail;
  push({
    id: 'contact', label: 'Contact form / click-to-call',
    status: contactOk ? 'ok' : 'issue',
    detail: [form ? 'has a form' : 'no form', tel ? 'click-to-call' : 'no click-to-call', freeMail ? 'uses a free email address' : null].filter(Boolean).join(', '),
    say: contactOk ? null : SAY.contact,
  }, 'no_contact_form');

  if (!flags.some((f) => ['no_ssl', 'old_copyright', 'not_mobile', 'template_look'].includes(f))) flags.push('modern_site');

  return { url, final_url: res.url, reachable: true, load_ms: ms, page_kb: kb, generator: generator || null, checks, flags };
}

function ruleSummary(checks: ScanCheck[]): { lines: string[]; question: string } {
  const issues = checks.filter((c) => c.status === 'issue');
  if (issues.length === 0) {
    return {
      lines: ['The site looks current: secure, mobile-friendly, recent.', 'Lead with bids/operations questions instead of the website.', 'Ask what % of their work is government vs. private.'],
      question: 'How are you finding new bids today?',
    };
  }
  return {
    lines: issues.slice(0, 3).map((c) => `${c.label}: ${c.detail}.`),
    question: issues[0].say || SAY.capability,
  };
}

export async function scanSite(rawUrl: string, userId: number | null, opts: { force?: boolean; withAi?: boolean } = {}): Promise<ScanResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    const s = ruleSummary([{ id: 'no_site', label: 'No site at all', status: 'issue', detail: 'URL blank', say: SAY.nosite }]);
    return {
      url: rawUrl, final_url: null, reachable: false, load_ms: null, page_kb: null, generator: null,
      checks: [{ id: 'no_site', label: 'No site at all', status: 'issue', detail: 'URL blank — note "NO SITE"', say: SAY.nosite }],
      flags: ['no_site'], summary_lines: ['No website listed for this lead.', ...s.lines.slice(1)], suggested_question: SAY.nosite,
      ai_used: false, ai_message: null, cached: false, scanned_at: new Date().toISOString(),
    };
  }

  const hash = crypto.createHash('sha256').update(new URL(url).hostname.replace(/^www\./, '')).digest('hex');
  if (!opts.force) {
    const hit = await queryOne<any>(
      `SELECT * FROM training_site_scans WHERE url_hash = $1 AND scanned_at > NOW() - ($2 || ' days')::interval`,
      [hash, String(CACHE_DAYS)]
    );
    if (hit) return { ...hit.checks_json, cached: true, scanned_at: hit.scanned_at };
  }

  const base = await runChecks(url);
  const rules = ruleSummary(base.checks);
  let summary_lines = rules.lines;
  let suggested_question = rules.question;
  let ai_used = false;
  let ai_message: string | null = null;

  if (opts.withAi !== false && base.reachable) {
    try {
      let pageText = '';
      try {
        const page = await fetch(base.final_url || url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.text());
        pageText = cheerio.load(page)('body').text().replace(/\s+/g, ' ').slice(0, 9000); // ≈3k tokens
      } catch { /* checks alone are enough */ }
      const r = await chatJSON<{ lines: string[]; suggested_question: string }>({
        feature: 'site_scan', userId, promptKey: 'site_scan_summary',
        vars: { url, checks: base.checks.map((c) => `${c.label}: ${c.status} — ${c.detail}`).join('\n'), text: pageText },
        maxTokens: 300,
      });
      if (Array.isArray(r.data.lines) && r.data.lines.length) {
        summary_lines = r.data.lines.slice(0, 3);
        suggested_question = r.data.suggested_question || suggested_question;
        ai_used = true;
      }
    } catch (err) {
      ai_message = err instanceof AiUnavailableError ? err.message : STANDARD_MODE_MESSAGE;
    }
  }

  const result: ScanResult = {
    ...base, summary_lines, suggested_question, ai_used, ai_message, cached: false, scanned_at: new Date().toISOString(),
  };
  await query(
    `INSERT INTO training_site_scans (url, url_hash, checks_json, summary_text, ai_used, scanned_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (url_hash) DO UPDATE SET url = EXCLUDED.url, checks_json = EXCLUDED.checks_json,
       summary_text = EXCLUDED.summary_text, ai_used = EXCLUDED.ai_used, scanned_at = CURRENT_TIMESTAMP`,
    [url, hash, JSON.stringify(result), summary_lines.join('\n'), ai_used]
  );
  return result;
}
