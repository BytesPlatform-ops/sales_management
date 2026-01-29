/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable server-side features
  experimental: {
    serverComponentsExternalPackages: ['pg', 'bcryptjs'],
  },
};

module.exports = nextConfig;
