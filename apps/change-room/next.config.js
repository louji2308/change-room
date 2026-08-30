/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: [
    "@change-room/agent",
    "@change-room/control",
    "@change-room/domain",
    "@change-room/flight-recorder",
    "@change-room/scenarios",
    "@change-room/simulator",
    "@change-room/verification",
    "@change-room/webmcp",
  ],
};

module.exports = nextConfig;
