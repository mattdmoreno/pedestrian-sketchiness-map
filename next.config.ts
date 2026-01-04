import type { NextConfig } from 'next';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // GitHub Pages requires a fully static build.
  output: 'export',
  trailingSlash: true,

  // For project pages, set NEXT_PUBLIC_BASE_PATH to '/<repo-name>' in CI.
  basePath,
  assetPrefix: basePath || undefined,

  // No Next image optimization on static export.
  images: { unoptimized: true },
};

export default nextConfig;
