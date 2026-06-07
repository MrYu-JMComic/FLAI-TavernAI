import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';
const apiProxyTimeoutMs = readPositiveInteger(
  process.env.VITE_API_PROXY_TIMEOUT_MS || process.env.API_PROXY_TIMEOUT_MS,
  10 * 60 * 1000
);
const proxy = {
  '/api': {
    target: apiProxyTarget,
    changeOrigin: true,
    timeout: apiProxyTimeoutMs,
    proxyTimeout: apiProxyTimeoutMs
  },
  '/uploads': {
    target: apiProxyTarget,
    changeOrigin: true,
    timeout: apiProxyTimeoutMs,
    proxyTimeout: apiProxyTimeoutMs
  }
};

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
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
  }
});
