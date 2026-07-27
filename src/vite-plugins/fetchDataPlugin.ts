import type { Plugin } from 'vite';
import { runFetchData } from '../../scripts/fetch-data-api.mjs';

export function fetchDataPlugin(): Plugin {
  return {
    name: 'fetch-data-plugin',
    configureServer(server) {
      server.middlewares.use('/api/fetch-data', async (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        try {
          const data = await runFetchData();
          res.end(JSON.stringify({ success: true, data }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: message }));
        }
      });
    },
  };
}
