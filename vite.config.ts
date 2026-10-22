import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Arbeitszeit',
        short_name: 'Arbeitszeit',
        description: 'Stempeluhr mit Zeitkonto, Freitagsregel und Erinnerungen.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#E8EDF1',
        theme_color: '#16233A',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [{ name: 'Stempeln', short_name: 'Stempeln', description: 'Sofort ein- oder ausstempeln', url: './?stempeln' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,vietnamese}-*'],
      },
    }),
  ],
});
