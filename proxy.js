import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number.parseInt(process.env.PROXY_PORT || '8787', 10);
const HOST = process.env.PROXY_HOST || '127.0.0.1';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const MAPTILER_API_KEY = process.env.MAPTILER_API_KEY || '';

const googleSessions = new Map();

const providers = {
  streetview: {
    layers: ['availability'],
    configured: () => true,
  },
  google: {
    layers: ['satellite', 'terrain'],
    configured: () => Boolean(GOOGLE_MAPS_API_KEY),
  },
  maptiler: {
    layers: ['satellite', 'terrain'],
    configured: () => Boolean(MAPTILER_API_KEY),
  },
  mapterhorn: {
    layers: ['terrain'],
    configured: () => true,
  },
  custom: {
    layers: ['satellite', 'terrain'],
    configured: () => Boolean(process.env.CUSTOM_SATELLITE_URL || process.env.CUSTOM_TERRAIN_URL),
  },
};

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error('[proxy] Unhandled request error:', error);
    sendJson(response, 500, { error: 'proxy_error', message: String(error?.message || error) });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[proxy] Orbital Surveyor proxy listening at http://${HOST}:${PORT}`);
  console.log('[proxy] Press Ctrl+C to stop.');
});

async function handleRequest(request, response) {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (requestUrl.pathname === '/health') {
    sendJson(response, 200, buildHealth());
    return;
  }

  if (requestUrl.pathname === '/providers') {
    sendJson(response, 200, { providers: buildProviderStatus() });
    return;
  }

  const tileMatch = requestUrl.pathname.match(/^\/tiles\/([^/]+)\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/);
  if (tileMatch) {
    const [, provider, layer, z, x, y] = tileMatch;
    await handleTile(response, provider, layer, z, x, y);
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
}

async function handleTile(response, provider, layer, z, x, y) {
  if (!providers[provider]) {
    sendJson(response, 404, { error: 'unknown_provider', provider });
    return;
  }
  if (!providers[provider].layers.includes(layer)) {
    sendJson(response, 400, { error: 'unsupported_layer', provider, layer });
    return;
  }
  if (!providers[provider].configured()) {
    sendJson(response, 503, { error: 'provider_not_configured', provider });
    return;
  }

  const upstreamUrl = await resolveTileUrl(provider, layer, z, x, y);
  proxyImage(response, upstreamUrl, getTileRequestHeaders(provider, layer));
}

async function resolveTileUrl(provider, layer, z, x, y) {
  if (provider === 'streetview' && layer === 'availability') {
    return `https://mts1.googleapis.com/vt?hl=en-US&lyrs=svv|cb_client:apiv3&style=40,18&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&z=${encodeURIComponent(z)}`;
  }

  if (provider === 'google') {
    const session = await getGoogleSession(layer);
    return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  }

  if (provider === 'maptiler') {
    const target = resolveMapTilerTarget(layer);
    return `https://api.maptiler.com/${target.kind}/${encodeURIComponent(target.id)}/${z}/${x}/${y}.${target.format}?key=${encodeURIComponent(MAPTILER_API_KEY)}`;
  }

  if (provider === 'mapterhorn') {
    return `${process.env.MAPTERHORN_TILE_URL || 'https://tiles.mapterhorn.com'}/${z}/${x}/${y}.webp`;
  }

  const template = layer === 'satellite'
    ? process.env.CUSTOM_SATELLITE_URL
    : process.env.CUSTOM_TERRAIN_URL;
  if (!template) {
    throw new Error(`Missing custom ${layer} URL template`);
  }
  return template
    .replaceAll('{z}', z)
    .replaceAll('{x}', x)
    .replaceAll('{y}', y);
}

function resolveMapTilerTarget(layer) {
  if (layer === 'satellite') {
    const mapId = process.env.MAPTILER_SATELLITE_MAP_ID || 'satellite-v4';
    const tilesetId = process.env.MAPTILER_SATELLITE_TILESET_ID;
    const format = process.env.MAPTILER_SATELLITE_FORMAT || 'jpg';
    return tilesetId
      ? { kind: 'tiles', id: tilesetId, format }
      : { kind: 'maps', id: mapId, format };
  }

  const id = process.env.MAPTILER_TERRAIN_TILESET_ID || process.env.MAPTILER_TERRAIN_MAP_ID || 'terrain-rgb-v2';
  const format = process.env.MAPTILER_TERRAIN_FORMAT || 'webp';
  return { kind: 'tiles', id: id === 'terrain' ? 'terrain-rgb-v2' : id, format };
}

function getTileRequestHeaders(provider, layer) {
  if (provider !== 'streetview' || layer !== 'availability') {
    return {};
  }

  return {
    'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'referer': 'https://www.google.com/',
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };
}

async function getGoogleSession(layer) {
  const cached = googleSessions.get(layer);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.session;
  }

  const body = JSON.stringify({
    mapType: layer === 'terrain' ? 'terrain' : 'satellite',
    language: process.env.GOOGLE_MAP_LANGUAGE || 'en-US',
    region: process.env.GOOGLE_MAP_REGION || 'US',
  });

  const result = await requestJson({
    method: 'POST',
    url: `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  });

  if (!result.session) {
    throw new Error('Google createSession response did not include a session token');
  }

  googleSessions.set(layer, {
    session: result.session,
    expiresAt: Date.now() + 50 * 60 * 1000,
  });

  return result.session;
}

function proxyImage(response, upstreamUrl, headers = {}) {
  https.get(upstreamUrl, { headers }, (upstream) => {
    const contentType = upstream.headers['content-type'] || 'application/octet-stream';

    if ((upstream.statusCode || 500) >= 400) {
      let body = '';
      upstream.setEncoding('utf8');
      upstream.on('data', (chunk) => {
        body += chunk;
      });
      upstream.on('end', () => {
        sendJson(response, upstream.statusCode || 502, {
          error: 'upstream_error',
          status: upstream.statusCode,
          message: body.slice(0, 1000),
        });
      });
      return;
    }

    response.writeHead(upstream.statusCode || 200, {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'content-type': contentType,
    });
    upstream.pipe(response);
  }).on('error', (error) => {
    sendJson(response, 502, { error: 'upstream_request_failed', message: error.message });
  });
}

function requestJson({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const request = https.request(
      {
        method,
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers,
      },
      (response) => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          payload += chunk;
        });
        response.on('end', () => {
          if ((response.statusCode || 500) >= 400) {
            reject(new Error(`HTTP ${response.statusCode}: ${payload}`));
            return;
          }
          try {
            resolve(JSON.parse(payload));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function buildHealth() {
  const providerStatus = buildProviderStatus();
  const anyConfigured = Object.values(providerStatus).some((provider) => provider.configured);
  return {
    ok: anyConfigured,
    status: anyConfigured ? 'ready' : 'No tile providers configured. Set GOOGLE_MAPS_API_KEY, MAPTILER_API_KEY, or CUSTOM_*_URL.',
    providers: providerStatus,
  };
}

function buildProviderStatus() {
  return Object.fromEntries(
    Object.entries(providers).map(([id, provider]) => [
      id,
      {
        configured: provider.configured(),
        layers: provider.layers,
      },
    ]),
  );
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
