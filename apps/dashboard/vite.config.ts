import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  esbuild: {
    jsx: 'automatic',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if ('writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: {
                    message: 'Backend server (port 3001) offline. Running in preview mode.',
                  },
                }),
              );
            }
          });
        },
      },
    },
  },
  build: {
    outDir: '../shopify-admin/public/dashboard',
    emptyOutDir: false,
    assetsDir: 'assets',
  },
});
