import axios, { AxiosProxyConfig } from 'axios';
import * as cheerio from 'cheerio';
import { getProxyManager } from './proxy-manager';

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  html: string;
  metaDescription: string | null;
  extractedEmails: string[];
  extractedPhones: string[];
  links: string[];
  scrapeSuccess: boolean;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();
}

function extractMainContent($: cheerio.CheerioAPI): string {
  const contentSelectors = ['main', 'article', '.content', '.main-content', '#content', '.post', '.entry', 'body'];
  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      return element.text();
    }
  }
  return $('body').text();
}

export function extractEmails(text: string): string[] {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = text.match(emailRegex) || [];
  return Array.from(new Set(emails));
}

export function extractPhones(text: string): string[] {
  const phoneRegex = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
  const phones = text.match(phoneRegex) || [];
  return Array.from(new Set(phones));
}

export function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer').remove();
  return cleanText($('body').text());
}

function extractInternalLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const baseDomain = new URL(baseUrl).hostname;
  const links: string[] = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      try {
        const fullUrl = new URL(href, baseUrl).href;
        const linkDomain = new URL(fullUrl).hostname;
        if (linkDomain === baseDomain) {
          links.push(fullUrl);
        }
      } catch {
        // Invalid URL, skip
      }
    }
  });
  return Array.from(new Set(links));
}

export async function cheerioScrape(url: string): Promise<ScrapeResult> {
  console.log(`[CHEERIO] Scraping URL: ${url}`);
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  const proxyManager = getProxyManager();
  const maxTotalAttempts = proxyManager.hasProxies() ? 2 : 1;

  for (let attempt = 0; attempt < maxTotalAttempts; attempt++) {
    let proxy: any = null;
    try {
      proxy = proxyManager.getNextProxy();
      const axiosProxy = proxyManager.getAxiosProxy(proxy);

      const requestConfig: any = {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 15000,
        maxRedirects: 5,
      };

      if (axiosProxy) {
        requestConfig.proxy = {
          protocol: 'http',
          host: axiosProxy.host,
          port: axiosProxy.port,
          auth: axiosProxy.auth,
        } as AxiosProxyConfig;
      }

      const response = await axios.get(fullUrl, requestConfig);
      const $ = cheerio.load(response.data);

      const title = $('title').text().trim();
      const metaDescription = $('meta[name="description"]').attr('content') || null;

      $('script, style, nav, header, footer').remove();

      const content = extractMainContent($);
      const html = cheerio.load(response.data).html() || '';
      const extractedEmailsList = extractEmails(content);
      const extractedPhonesList = extractPhones(content);
      const links = extractInternalLinks(cheerio.load(response.data), fullUrl);

      return {
        url: fullUrl,
        title,
        content: cleanText(content),
        html,
        metaDescription,
        extractedEmails: extractedEmailsList,
        extractedPhones: extractedPhonesList,
        links,
        scrapeSuccess: true,
      };
    } catch (error: any) {
      console.error(`[CHEERIO] Scraping failed for ${url} (attempt ${attempt + 1}/${maxTotalAttempts}):`, error.message);
      if (proxy) proxyManager.markProxyFailed(proxy);
      if (attempt === maxTotalAttempts - 1) {
        throw new Error(`Unable to access website after ${maxTotalAttempts} attempts.`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  throw new Error('Unable to access website. All attempts exhausted.');
}
