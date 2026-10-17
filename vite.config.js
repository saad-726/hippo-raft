import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(projectRoot, 'client');
const levelsPath = resolve(projectRoot, 'shared/levels.json');

function sharedLevelData(serverUrl) {
  const serveLevels = async (request, response, next) => {
    if (request.url?.split('?')[0] !== '/shared/levels.json') return next();
    try {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-cache');
      response.end(await readFile(levelsPath));
    } catch (error) {
      next(error);
    }
  };

  return {
    name: 'shared-level-data',
    transformIndexHtml() {
      return [{
        tag: 'script',
        children: `window.HIPPO_RAFT_SERVER_URL = ${JSON.stringify(serverUrl)};`,
        injectTo: 'head',
      }];
    },
    configureServer(server) {
      server.middlewares.use(serveLevels);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveLevels);
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'shared/levels.json',
        source: await readFile(levelsPath),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, ['VITE_', 'HIPPO_RAFT_']);
  const serverUrl = process.env.HIPPO_RAFT_SERVER_URL || env.HIPPO_RAFT_SERVER_URL || '';
  return {
    root: clientRoot,
    publicDir: false,
    plugins: [sharedLevelData(serverUrl)],
    server: {
      host: '0.0.0.0',
      port: Number(process.env.CLIENT_PORT || 4173),
      allowedHosts: true, // allow cloudflared / ngrok tunnels
      fs: { allow: [projectRoot] },
    },
    preview: {
      host: '0.0.0.0',
      port: Number(process.env.CLIENT_PORT || 4173),
      allowedHosts: true,
    },
    build: {
      outDir: resolve(projectRoot, 'dist'),
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/three/')) return 'three';
            if (id.includes('/node_modules/@dimforge/rapier3d-compat/')) return 'rapier';
          },
        },
      },
    },
  };
});
