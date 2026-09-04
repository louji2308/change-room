const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../"),
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Origin-Agent-Cluster", value: "?1" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
