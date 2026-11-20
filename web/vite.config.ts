import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const defaultApiTarget = existsSync('/.dockerenv')
  ? 'http://api:8000'
  : 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Split large dependency trees into separate chunks so they can be cached
    // independently across deploys. Vendor (React) and UI (Radix + Lucide) rarely
    // change, so the browser only re-downloads page chunks on app updates.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/@remix-run/router') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor';
          }
          if (id.includes('node_modules/@tanstack/')) {
            return 'query';
          }
          if (
            id.includes('node_modules/motion') ||
            id.includes('node_modules/framer-motion')
          ) {
            return 'motion';
          }
          if (
            id.includes('node_modules/i18next') ||
            id.includes('node_modules/react-i18next') ||
            id.includes('/src/i18n/')
          ) {
            return 'i18n';
          }
          if (
            id.includes('node_modules/@radix-ui/') ||
            id.includes('node_modules/lucide-react') ||
            id.includes('node_modules/class-variance-authority') ||
            id.includes('node_modules/clsx') ||
            id.includes('node_modules/tailwind-merge')
          ) {
            return 'ui';
          }
          if (id.includes('/src/components/landing/')) {
            return 'landing-widgets';
          }
          if (
            id.includes('/src/pages/LoginPage') ||
            id.includes('/src/pages/RegisterPage') ||
            id.includes('/src/components/AuthSplitShell') ||
            id.includes('/src/components/GoogleAuthButton')
          ) {
            return 'auth';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || defaultApiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || defaultApiTarget,
        changeOrigin: true,
      },
    },
  },
});
