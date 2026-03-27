interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

class ProxyManager {
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;
  private failedProxies = new Set<number>();

  constructor() {
    this.loadProxies();
  }

  private loadProxies(): void {
    const proxiesEnv = process.env.WEBSHARE_PROXIES;
    if (proxiesEnv) {
      const proxyList = proxiesEnv.split(',').map(p => p.trim()).filter(p => p);
      this.proxies = proxyList.map(proxy => this.parseProxy(proxy));
      console.log(`[PROXY] Loaded ${this.proxies.length} proxies from WEBSHARE_PROXIES`);
    } else {
      let index = 1;
      const loadedProxies: ProxyConfig[] = [];
      while (true) {
        const proxyEnv = process.env[`WEBSHARE_PROXY_${index}`];
        if (!proxyEnv) break;
        loadedProxies.push(this.parseProxy(proxyEnv));
        index++;
      }
      if (loadedProxies.length > 0) {
        this.proxies = loadedProxies;
        console.log(`[PROXY] Loaded ${this.proxies.length} proxies from individual WEBSHARE_PROXY_* variables`);
      } else {
        console.log(`[PROXY] No proxies configured. Scraping will use direct connection.`);
      }
    }
  }

  private parseProxy(proxyString: string): ProxyConfig {
    try {
      const url = new URL(proxyString);
      return {
        server: `${url.protocol}//${url.hostname}:${url.port}`,
        username: url.username || undefined,
        password: url.password || undefined,
      };
    } catch {
      throw new Error(`Invalid proxy format: ${proxyString}`);
    }
  }

  getNextProxy(): ProxyConfig | null {
    if (this.proxies.length === 0) return null;

    if (this.failedProxies.size >= this.proxies.length) {
      this.failedProxies.clear();
    }

    let attempts = 0;
    while (attempts < this.proxies.length) {
      const idx = this.currentIndex;
      const proxy = this.proxies[idx];
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      if (!this.failedProxies.has(idx)) {
        return proxy;
      }
      attempts++;
    }

    return this.proxies[0];
  }

  markProxyFailed(proxy: ProxyConfig): void {
    const index = this.proxies.findIndex(p => p.server === proxy.server);
    if (index !== -1) {
      this.failedProxies.add(index);
    }
  }

  hasProxies(): boolean {
    return this.proxies.length > 0;
  }

  getAxiosProxy(proxy: ProxyConfig | null): { host: string; port: number; auth?: { username: string; password: string } } | undefined {
    if (!proxy) return undefined;
    try {
      const url = new URL(proxy.server);
      const config: any = { host: url.hostname, port: parseInt(url.port, 10) };
      if (proxy.username && proxy.password) {
        config.auth = { username: proxy.username, password: proxy.password };
      }
      return config;
    } catch {
      return undefined;
    }
  }

  getPlaywrightProxy(proxy: ProxyConfig | null): { server: string; username?: string; password?: string } | undefined {
    if (!proxy) return undefined;
    return { server: proxy.server, username: proxy.username, password: proxy.password };
  }
}

// Singleton instance
let proxyManagerInstance: ProxyManager | null = null;

export function getProxyManager(): ProxyManager {
  if (!proxyManagerInstance) {
    proxyManagerInstance = new ProxyManager();
  }
  return proxyManagerInstance;
}

export type { ProxyConfig };
