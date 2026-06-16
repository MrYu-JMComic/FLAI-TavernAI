import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';
const apiProxyTimeoutMs = readPositiveInteger(
  process.env.VITE_API_PROXY_TIMEOUT_MS || process.env.API_PROXY_TIMEOUT_MS,
  10 * 60 * 1000
);
const proxy = {
  '/api': createBackendProxy(),
  '/uploads': createBackendProxy()
};

function createBackendProxy() {
  return {
    target: apiProxyTarget,
    changeOrigin: true,
    timeout: apiProxyTimeoutMs,
    proxyTimeout: apiProxyTimeoutMs,
    configure(proxy) {
      proxy.on('error', (_error, _request, response) => {
        writeBackendUnavailableResponse(response);
      });
    }
  };
}

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function writeBackendUnavailableResponse(response) {
  if (!response || response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(503, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': '1'
  });
  response.end('Backend is not available yet. Start or wait for http://127.0.0.1:3001/api/health.');
}

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy
  },
  build: {
    rollupOptions: {
      output: {
        // 手动分包策略 - 提取大型依赖到独立chunk
        manualChunks(id) {
          // Vue核心框架
          if (id.includes('node_modules/vue/')) {
            return 'vue-core';
          }
          // Lucide图标库
          if (id.includes('@lucide/vue')) {
            return 'lucide-icons';
          }
          // Markdown渲染相关（较大）
          if (id.includes('markdown-it') || id.includes('highlight.js')) {
            return 'markdown-renderer';
          }
          // DOMPurify安全库
          if (id.includes('dompurify')) {
            return 'dom-sanitizer';
          }
          // 虚拟滚动
          if (id.includes('@tanstack/vue-virtual')) {
            return 'virtual-scroller';
          }
        }
      }
    },
    // CSS代码分割
    cssCodeSplit: true,
    // chunk大小警告阈值
    chunkSizeWarningLimit: 500,
    // 禁用源码映射减小体积
    sourcemap: false,
    // 目标浏览器
    target: 'es2020'
  }
});
