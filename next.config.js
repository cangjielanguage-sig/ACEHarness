/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 开发服务器配置
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },
};

module.exports = nextConfig;
