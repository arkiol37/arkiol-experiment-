// next.config.js
/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

// CSP policy notes:
//   'unsafe-inline' on style-src: Required by Next.js — it injects <style> tags
//     for CSS Modules and styled-jsx. Cannot use nonces without breaking streaming in 14.x.
//   'unsafe-eval' on script-src: ONLY in dev — Next.js Fast Refresh uses eval() for HMR.
//     Stripped in production builds.
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline'";

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control',   value: 'on' },
  { key: 'X-Frame-Options',          value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',   value: 'nosniff' },
  { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',       value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://cdn.arkiol.ai https://*.s3.amazonaws.com https://*.s3.us-east-1.amazonaws.com",
      "connect-src 'self' https://*.sentry.io https://sentry.io https://api.paddle.com https://sandbox-api.paddle.com https://fonts.googleapis.com https://fonts.gstatic.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  transpilePackages: ['@arkiol/shared'],

  // Keep type safety on, but do not let accumulated lint debt block production builds
  eslint:     { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  // Next.js 14.x uses the experimental key for server externals
  experimental: {
    serverComponentsExternalPackages: ['sharp', 'canvas', 'gif-encoder-2', 'ioredis', 'bullmq', 'pg', '@prisma/adapter-pg'],
  },

  async redirects() {
    return [
      { source: '/auth/login',          destination: '/login',          permanent: true },
      { source: '/auth/register',       destination: '/register',       permanent: true },
      { source: '/auth/reset-password', destination: '/reset-password', permanent: true },
      { source: '/auth/set-password',   destination: '/set-password',   permanent: true },
      { source: '/auth/error',          destination: '/error',          permanent: false },
    ];
  },

  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control',  value: 'no-store, no-cache, must-revalidate' },
          { key: 'X-Robots-Tag',   value: 'noindex' },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.arkiol.ai' },
    ],
    minimumCacheTTL: 3600,
    formats:         ['image/avif', 'image/webp'],
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        'html2canvas',
      ];
    }
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, path: false, crypto: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
