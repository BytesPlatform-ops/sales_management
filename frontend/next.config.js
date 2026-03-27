/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable server-side features
  experimental: {
    serverComponentsExternalPackages: ['pg', 'bcryptjs', 'undici', 'cheerio', 'axios', 'playwright'],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
