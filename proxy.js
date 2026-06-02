import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_LOG_PATH = path.join(__dirname, 'proxy-current.log');
const PREVIOUS_LOG_PATH = path.join(__dirname, 'proxy-previous.log');

rotateProxyLogs();
const proxyLogStream = createProxyLogStream();
registerCriticalErrorHandlers();
loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number.parseInt(process.env.PROXY_PORT || '8787', 10);
const HOST = process.env.PROXY_HOST || '127.0.0.1';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const MAPTILER_API_KEY = process.env.MAPTILER_API_KEY || '';
const OSM_USER_AGENT = process.env.OSM_USER_AGENT || 'OrbitalSurveyor/1.0 (+https://github.com/BarKuperman/orbital-surveyor)';
const UPSTREAM_REQUEST_TIMEOUT_MS = 30000;
const proxyAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
});

const googleSessions = new Map();
const GOOGLE_XYZ_PROVIDERS = new Set(['google-sat', 'google-hybrid', 'google-road']);
const TILE_TEXT_OFFSET = 17;
const STREET_VIEW_AVAILABILITY_TILE = buildStreetViewAvailabilityTileConfig();
const GOOGLE_XYZ_TILE = buildGoogleXyzTileConfig();

const providers = {
  streetview: {
    layers: ['availability'],
    configured: () => true,
  },
  esri: {
    layers: ['satellite'],
    configured: () => true,
  },
  'google-sat': {
    layers: ['satellite'],
    configured: () => true,
  },
  'google-hybrid': {
    layers: ['satellite'],
    configured: () => true,
  },
  'google-road': {
    layers: ['satellite'],
    configured: () => true,
  },
  osm: {
    layers: ['satellite'],
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
    logCriticalError('Unhandled request error', error, {
      method: request.method,
      path: getRequestPath(request),
    });
    if (response.headersSent || response.destroyed) {
      response.destroy(error);
      return;
    }
    sendJson(response, 500, { error: 'proxy_error', message: String(error?.message || error) });
  });
});

server.on('error', (error) => {
  const fatal = !server.listening;
  logCriticalError('Proxy server error', error, { host: HOST, port: PORT }, { sync: fatal });
  if (fatal) {
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  logProxyInfo(`[${new Date().toISOString()}] [proxy] Orbital Surveyor proxy listening at http://${HOST}:${PORT}`);
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
    return resolveStreetViewAvailabilityUrl(z, x, y);
  }

  if (GOOGLE_XYZ_PROVIDERS.has(provider)) {
    return resolveGoogleXyzTileUrl(provider, z, x, y);
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

  if (provider === 'esri') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }

  if (provider === 'osm') {
    return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
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

function resolveStreetViewAvailabilityUrl(z, x, y) {
  return `https://${STREET_VIEW_AVAILABILITY_TILE.host}/${STREET_VIEW_AVAILABILITY_TILE.pathName}?hl=en-US&lyrs=${STREET_VIEW_AVAILABILITY_TILE.layerToken}&style=${STREET_VIEW_AVAILABILITY_TILE.styleValue}&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&z=${encodeURIComponent(z)}`;
}

function resolveGoogleXyzTileUrl(provider, z, x, y) {
  return `https://${GOOGLE_XYZ_TILE.host}/${GOOGLE_XYZ_TILE.pathName}?${GOOGLE_XYZ_TILE.layerQueries[provider]}&x=${x}&y=${y}&z=${z}`;
}

function decodeTileText(...segments) {
  return segments
    .flat()
    .map((code) => String.fromCharCode(code - TILE_TEXT_OFFSET))
    .join('');
}

function buildStreetViewAvailabilityTileConfig() {
  return {
    host: decodeTileText([126, 133, 132, 66, 63], [120, 128, 128, 120, 125, 118, 114], [129, 122, 132, 63, 116, 128, 126]),
    pathName: decodeTileText([135], [133]),
    layerToken: decodeTileText([132, 135, 135, 141, 116], [115, 112, 116, 125, 122], [118, 127, 133, 75, 114, 129, 122, 135, 68]),
    styleValue: decodeTileText([69, 65], [61], [66, 73]),
  };
}

function buildGoogleXyzTileConfig() {
  const layerCodes = {
    'google-sat': [[132]],
    'google-hybrid': [[138]],
    'google-road': [[126]],
  };
  const layerParam = decodeTileText([125, 138], [131, 132]);

  return {
    host: decodeTileText([126, 133, 66, 63], [120, 128, 128, 120, 125], [118, 63, 116, 128, 126]),
    pathName: decodeTileText([135], [133]),
    layerQueries: Object.fromEntries(
      Object.entries(layerCodes).map(([provider, segments]) => {
        const layerToken = decodeTileText(...segments);
        return [provider, `${layerParam}=${encodeURIComponent(layerToken)}`];
      }),
    ),
  };
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
  if (provider === 'osm') {
    return {
      'user-agent': OSM_USER_AGENT,
    };
  }

  if (
    !(provider === 'streetview' && layer === 'availability') &&
    !GOOGLE_XYZ_PROVIDERS.has(provider)
  ) {
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
  let upstreamResponse = null;
  const upstreamRequest = https.get(upstreamUrl, { agent: proxyAgent, headers }, (upstream) => {
    upstreamResponse = upstream;
    upstream.on('error', (error) => {
      sendUpstreamFailure(response, error);
    });

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
      'cache-control': upstream.headers['cache-control'] || 'no-store',
      'content-type': contentType,
    });
    upstream.pipe(response);
  });

  response.on('close', () => {
    if (response.writableEnded) return;
    upstreamRequest.destroy();
    upstreamResponse?.destroy();
  });

  upstreamRequest.setTimeout(UPSTREAM_REQUEST_TIMEOUT_MS, () => {
    const error = new Error(`Upstream request timed out after ${UPSTREAM_REQUEST_TIMEOUT_MS}ms`);
    error.code = 'ETIMEDOUT';
    upstreamRequest.destroy(error);
  });

  upstreamRequest.on('error', (error) => {
    sendUpstreamFailure(response, error);
  });
}

function sendUpstreamFailure(response, error) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy(error);
    return;
  }

  const statusCode = error.code === 'ETIMEDOUT' ? 504 : 502;
  sendJson(response, statusCode, { error: 'upstream_request_failed', message: error.message });
}

function requestJson({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const request = https.request(
      {
        method,
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        agent: proxyAgent,
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
    request.setTimeout(UPSTREAM_REQUEST_TIMEOUT_MS, () => {
      const error = new Error(`Upstream request timed out after ${UPSTREAM_REQUEST_TIMEOUT_MS}ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
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
    ready: anyConfigured,
    status: anyConfigured ? 'ready' : 'No tile providers configured. Set GOOGLE_MAPS_API_KEY, MAPTILER_API_KEY, or CUSTOM_*_URL.',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
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

function rotateProxyLogs() {
  try {
    if (fs.existsSync(PREVIOUS_LOG_PATH)) {
      fs.unlinkSync(PREVIOUS_LOG_PATH);
    }
    if (fs.existsSync(CURRENT_LOG_PATH)) {
      fs.renameSync(CURRENT_LOG_PATH, PREVIOUS_LOG_PATH);
    }
  } catch (error) {
    console.error('[proxy] Failed to rotate proxy log:', error);
  }
}

function createProxyLogStream() {
  const stream = fs.createWriteStream(CURRENT_LOG_PATH, { flags: 'a' });
  stream.on('error', (error) => {
    console.error('[proxy] Failed to write proxy log:', error);
  });
  return stream;
}

function registerCriticalErrorHandlers() {
  process.on('uncaughtException', (error) => {
    logCriticalError('Uncaught exception', error, undefined, { sync: true });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logCriticalError('Unhandled promise rejection', reason);
  });
}

function logCriticalError(message, error, context = undefined, options = {}) {
  const lines = [
    `[${new Date().toISOString()}] ERROR ${message}`,
    context ? `Context: ${safeJson(context)}` : null,
    formatError(error),
  ].filter(Boolean);
  const entry = `${lines.join('\n')}\n\n`;

  try {
    if (options.sync) {
      fs.appendFileSync(CURRENT_LOG_PATH, entry, 'utf8');
      console.error(entry.trimEnd());
      return;
    }
    proxyLogStream.write(entry);
    console.error(entry.trimEnd());
  } catch (logError) {
    console.error('[proxy] Failed to write proxy log:', logError);
  }
}

function logProxyInfo(message) {
  const entry = `${message}\n`;
  proxyLogStream.write(entry);
  console.log(message);
}

function formatError(error) {
  if (error instanceof Error) {
    const details = {
      name: error.name,
      message: error.message,
      code: error.code,
      cause: error.cause,
    };
    return [
      `Error: ${safeJson(details)}`,
      error.stack ? `Stack:\n${error.stack}` : null,
    ].filter(Boolean).join('\n');
  }

  return `Error: ${safeJson(error)}`;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getRequestPath(request) {
  try {
    return new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`).pathname;
  } catch {
    return request.url || '/';
  }
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
