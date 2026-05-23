import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Puffchat',
        short_name: 'Puffchat',
        description: 'Anonymous ephemeral two-person chat',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/app/',
        scope: '/app/',
        icons: [
          {
            src: '/app/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/app/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/app/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache JS, CSS, HTML, fonts — not PNGs (icons handled below)
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Explicitly precache the three icon files (not picked up by glob above)
        additionalManifestEntries: [
          { url: 'apple-touch-icon.png', revision: null },
          { url: 'icon-192.png',         revision: null },
          { url: 'icon-512.png',         revision: null },
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-static',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  base: '/app/',
})
