import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001';
const proxy = {
  '/api': {
    target: apiProxyTarget,
    changeOrigin: true
  },
  '/uploads': {
    target: apiProxyTarget,
    changeOrigin: true
  }
};

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
