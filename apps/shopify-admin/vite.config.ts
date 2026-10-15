import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

// Shopify CLI supplies the tunnel URL and ports. Restrict host validation to that URL.
const host = new URL(process.env['SHOPIFY_APP_URL'] ?? 'http://localhost').hostname;
export default defineConfig({
  plugins: [reactRouter()],
  server: {
    allowedHosts: [host],
    port: Number(process.env['PORT'] ?? 3001),
    cors: { preflightContinue: true },
    hmr:
      host === 'localhost'
        ? { protocol: 'ws', host: 'localhost', port: 64999, clientPort: 64999 }
        : {
            protocol: 'wss',
            host,
            port: Number(process.env['FRONTEND_PORT'] ?? 8002),
            clientPort: 443,
          },
  },
  build: { assetsInlineLimit: 0 },
});
