import type { Connect, Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { handleVerifyRequest } from './server/license.ts';

/**
 * Serves POST /api/verify-license in `npm run dev` and `npm run preview` with the same code the
 * production Cloudflare Pages Function uses. Reads GUMROAD_PRODUCT_ID from the shell environment
 * (never from a VITE_ variable, so it is not bundled into the browser code).
 */
function licenseApi(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/api/verify-license')) return next();
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const request = new Request('http://localhost/api/verify-license', {
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
        body: req.method === 'POST' ? Buffer.concat(chunks).toString('utf8') : undefined,
      });
      const response = await handleVerifyRequest(request, process.env.GUMROAD_PRODUCT_ID);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });
  };
  return {
    name: 'license-api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  plugins: [react(), licenseApi()],
  test: {
    environment: 'node',
  },
});
