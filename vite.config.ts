import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// mode "electron": sem service worker (o app é servido pelo protocolo quartzo://)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    mode !== 'electron' &&
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Quartzo',
          short_name: 'Quartzo',
          description: 'Notas em Markdown conectadas e sincronizadas com o Recalchi Manage',
          theme_color: '#1b1428',
          background_color: '#141019',
          display: 'standalone',
          start_url: './',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
      }),
  ].filter(Boolean),
  resolve: {
    alias: mode === 'electron' ? { 'virtual:pwa-register': '/src/lib/pwa-stub.ts' } : {},
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
}));
