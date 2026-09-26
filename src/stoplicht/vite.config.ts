import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import aurelia from '@aurelia/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/ ; the deploy workflow sets BASE_PATH accordingly.
  base: process.env.BASE_PATH ?? '/',
  server: {
    open: !process.env.CI,
    port: 9000,
  },
  esbuild: {
    target: 'es2022'
  },
  plugins: [
    aurelia({
      useDev: true,
    }),
    tailwindcss(),
    nodePolyfills(),
    VitePWA({
      registerType: 'autoUpdate',
      // also register the service worker on the dev server, so the install flow can be tried locally
      devOptions: { enabled: true, navigateFallback: 'index.html' },
      includeAssets: ['favicon.ico', 'icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Stoplicht – stoplicht.com',
        short_name: 'Stoplicht',
        description: 'Stoplicht (stoplicht.com): stem de verkeerslichten af en laat alle auto\'s zo snel mogelijk de stad uit.',
        id: 'stoplicht.com',
        lang: 'nl',
        display: 'standalone',
        orientation: 'any',
        background_color: '#e6efdc',
        theme_color: '#e6efdc',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // levels and icons are part of the offline bundle
        globPatterns: ['**/*.{js,css,html,json,png,svg,ico,woff2}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
