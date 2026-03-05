import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/agents', destination: '/', permanent: false },
      { source: '/check-in', destination: '/', permanent: false },
      { source: '/challenges', destination: '/', permanent: false },
      { source: '/community', destination: '/', permanent: false },
      { source: '/reports', destination: '/', permanent: false },
      { source: '/store', destination: '/', permanent: false },
      { source: '/settings/api-keys', destination: '/', permanent: false }
    ];
  }
};

export default nextConfig;
