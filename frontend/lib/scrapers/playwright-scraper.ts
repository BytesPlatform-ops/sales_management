import { getProxyManager } from './proxy-manager';
import { extractEmails, extractPhones } from './cheerio-scraper';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();
}

let browserInstance: any = null;

async function getBrowser() {
  if (browserInstance) return browserInstance;
  try {
    const { chromium } = await import('playwright');
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });
    return browserInstance;
  } catch (error: any) {
    console.error('[PLAYWRIGHT] Failed to launch browser:', error.message);
    throw new Error('Playwright browser not available. Install with: npx playwright install chromium');
  }
}

export async function playwrightScrape(url: string): Promise<any> {
  console.log(`[PLAYWRIGHT] Scraping dynamic URL: ${url}`);
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  const proxyManager = getProxyManager();
  const maxTotalAttempts = proxyManager.hasProxies() ? 2 : 1;
  let cloudflareBlockCount = 0;

  for (let attempt = 0; attempt < maxTotalAttempts; attempt++) {
    let page: any = null;
    let context: any = null;
    let proxy: any = null;

    try {
      const browser = await getBrowser();
      proxy = proxyManager.getNextProxy();
      const playwrightProxy = proxyManager.getPlaywrightProxy(proxy);

      const contextOptions: any = {
        userAgent: getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        screen: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: [],
        geolocation: { longitude: -74.006, latitude: 40.7128 },
        colorScheme: 'light' as const,
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
        },
      };

      if (playwrightProxy) {
        contextOptions.proxy = playwrightProxy;
      }

      context = await browser.newContext(contextOptions);
      page = await context.newPage();

      // Remove webdriver detection
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        (window as any).chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });

      // Block images, fonts, media for speed
      await page.route('**/*', (route: any) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      // Random delay to appear human
      const randomDelay = Math.floor(Math.random() * 2000) + 1000;
      await page.waitForTimeout(randomDelay);

      await page.goto(fullUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
        referer: 'https://www.google.com/',
      });

      try {
        await page.waitForSelector('body', { timeout: 10000 });
      } catch {
        // proceed
      }

      // Check for Cloudflare challenge
      const isCloudflareChallenge = await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        return bodyText.includes('Please enable cookies') ||
          bodyText.includes('Checking your browser') ||
          bodyText.includes('Just a moment') ||
          bodyText.includes('DDoS protection by Cloudflare') ||
          bodyText.includes('you have been blocked') ||
          document.title.includes('Just a moment') ||
          document.title.includes('Please Wait');
      });

      if (isCloudflareChallenge) {
        console.log(`[PLAYWRIGHT] Cloudflare challenge detected, attempting to bypass...`);
        try {
          await page.mouse.move(Math.random() * 500, Math.random() * 500);
          await page.waitForTimeout(1000);
          await page.evaluate(() => { window.scrollBy(0, Math.random() * 200); });
          await page.waitForTimeout(1000);
        } catch { /* ignore */ }

        let challengeResolved = false;
        for (let check = 0; check < 15; check++) {
          await page.waitForTimeout(2000);
          const stillBlocked = await page.evaluate(() => {
            const bodyText = document.body.textContent || '';
            const title = document.title.toLowerCase();
            return bodyText.includes('Please enable cookies') ||
              bodyText.includes('Checking your browser') ||
              bodyText.includes('Just a moment') ||
              bodyText.includes('you have been blocked') ||
              title.includes('just a moment') ||
              title.includes('please wait');
          });
          if (!stillBlocked) {
            challengeResolved = true;
            break;
          }
          if (check % 3 === 0) {
            try { await page.mouse.move(Math.random() * 800, Math.random() * 600); } catch { /* ignore */ }
          }
        }

        if (!challengeResolved) {
          throw new Error('Cloudflare challenge not resolved after 30 seconds');
        }

        try {
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        } catch { /* ignore */ }
        await page.waitForTimeout(2000);
      }

      await page.waitForTimeout(3000);

      // Check for auto-redirect
      const currentUrl = page.url();
      const targetUrlNormalized = new URL(fullUrl).pathname.replace(/\/$/, '');
      const currentUrlNormalized = new URL(currentUrl).pathname.replace(/\/$/, '');
      if (targetUrlNormalized && currentUrlNormalized !== targetUrlNormalized) {
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
      }

      // Extract content
      const title = await page.title();
      const metaDescription = await page.$eval('meta[name="description"]',
        (el: any) => el.getAttribute('content')).catch(() => null);

      const content = await page.evaluate(() => {
        document.querySelectorAll('script, style').forEach(el => el.remove());
        const contentSelectors = [
          'main', 'article', '.content', '.main-content',
          '#content', '.post', '.entry', '#root', '#app',
          '.container', '.wrapper', '.page', 'body',
        ];
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent && element.textContent.trim().length > 100) {
            return element.textContent || '';
          }
        }
        return document.body.textContent || '';
      });

      const html = await page.content();

      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(el => el.getAttribute('href'))
          .filter(href => href && href.startsWith('http'));
      });

      if (page) await page.close();
      if (context) await context.close();

      return {
        url: fullUrl,
        title,
        content: cleanText(content),
        html,
        metaDescription,
        extractedEmails: extractEmails(content),
        extractedPhones: extractPhones(content),
        links: links || [],
        scrapeSuccess: true,
      };
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      const isCloudflareBlock = errorMessage.includes('Cloudflare');

      console.error(`[PLAYWRIGHT] Scraping failed (attempt ${attempt + 1}/${maxTotalAttempts}):`, errorMessage);

      if (page) try { await page.close(); } catch { /* ignore */ }
      if (context) try { await context.close(); } catch { /* ignore */ }

      if (isCloudflareBlock) {
        cloudflareBlockCount++;
        if (cloudflareBlockCount >= 1) {
          throw new Error('Site is blocking automated access via Cloudflare.');
        }
      } else if (proxy) {
        proxyManager.markProxyFailed(proxy);
      }

      if (attempt === maxTotalAttempts - 1) {
        throw new Error(`Unable to access website after ${maxTotalAttempts} attempts.`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  throw new Error('Unable to access website. All attempts exhausted.');
}

export async function cleanupBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
