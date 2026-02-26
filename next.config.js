/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 开发服务器配置
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },

  // 抑制开发模式下的 fetch 日志
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
};

module.exports = nextConfig;
