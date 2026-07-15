import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_PROVIDERS,
  createProviderCatalog,
  parseCustomProviders,
} from './src/providers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, 'logs');
const CURRENT_LOG_PATH = path.join(LOG_DIR, 'proxy-current.log');
const PREVIOUS_LOG_PATH = path.join(LOG_DIR, 'proxy-previous.log');
const CUSTOM_PROVIDERS_PATH = path.join(__dirname, 'custom-providers.json');

ensureProxyLogDirectory();
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
const MAX_UPSTREAM_REDIRECTS = 5;
const TILE_FAILURE_LOG_INTERVAL_MS = 15000;
const TILE_CACHE_CONTROL = 'public, max-age=604800, stale-if-error=2592000';
const proxyAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
});
const proxyHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
});

const googleSessions = new Map();
const tileFailureCounts = new Map();
let tileFailureFlushTimer = null;
const TILE_TEXT_OFFSET = 17;
const STREET_VIEW_AVAILABILITY_TILE = buildStreetViewAvailabilityTileConfig();
const GOOGLE_XYZ_TILE = buildGoogleXyzTileConfig();
const customProviders = loadCustomProviders();
const providerDefinitions = [...BUILTIN_PROVIDERS, ...customProviders];
const providers = Object.fromEntries(providerDefinitions.map((provider) => [provider.id, provider]));
const providerCatalog = createProviderCatalog(providerDefinitions, process.env);

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
  const definition = providers[provider];
  if (!definition) {
    sendJson(response, 404, { error: 'unknown_provider', provider });
    return;
  }
  if (!definition.layers[layer]) {
    sendJson(response, 400, { error: 'unsupported_layer', provider, layer });
    return;
  }
  if (!providerCatalog[provider]?.layers[layer]?.configured) {
    sendJson(response, 503, { error: 'provider_not_configured', provider });
    return;
  }

  const upstreamUrl = await resolveTileUrl(definition, layer, z, x, y);
  proxyImage(response, upstreamUrl, getTileRequestHeaders(definition), { provider, layer });
}

async function resolveTileUrl(provider, layer, z, x, y) {
  const resolver = provider.resolver;
  if (resolver.kind === 'streetview-availability') {
    return resolveStreetViewAvailabilityUrl(z, x, y);
  }
  if (resolver.kind === 'google-xyz') {
    return resolveGoogleXyzTileUrl(resolver.variant, z, x, y);
  }
  if (resolver.kind === 'google-map-tiles') {
    const session = await getGoogleSession();
    return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  }
  if (resolver.kind === 'maptiler') {
    const target = resolveMapTilerTarget(layer);
    return `https://api.maptiler.com/${target.kind}/${encodeURIComponent(target.id)}/${z}/${x}/${y}.${target.format}?key=${encodeURIComponent(MAPTILER_API_KEY)}`;
  }
  if (resolver.kind === 'mapterhorn') {
    return `${process.env.MAPTERHORN_TILE_URL || 'https://tiles.mapterhorn.com'}/${z}/${x}/${y}.webp`;
  }
  if (resolver.kind === 'esri') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  if (resolver.kind === 'osm') {
    return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }
  if (resolver.kind === 'custom-template') {
    return resolver.urlTemplate
      .replaceAll('{z}', z)
      .replaceAll('{x}', x)
      .replaceAll('{y}', y);
  }
  throw new Error(`Unsupported resolver for provider ${provider.id}`);
}

function resolveStreetViewAvailabilityUrl(z, x, y) {
  return `https://${STREET_VIEW_AVAILABILITY_TILE.host}/${STREET_VIEW_AVAILABILITY_TILE.pathName}?hl=en-US&${STREET_VIEW_AVAILABILITY_TILE.layerParam}=${STREET_VIEW_AVAILABILITY_TILE.layerToken}&style=${STREET_VIEW_AVAILABILITY_TILE.styleValue}&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&z=${encodeURIComponent(z)}`;
}

function resolveGoogleXyzTileUrl(variant, z, x, y) {
  return `https://${GOOGLE_XYZ_TILE.host}/${GOOGLE_XYZ_TILE.pathName}?${GOOGLE_XYZ_TILE.layerQueries[variant]}&x=${x}&y=${y}&z=${z}`;
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
    layerParam: decodeTileText([125, 138], [131, 132]),
    layerToken: decodeTileText([132, 135, 135, 141, 116], [115, 112, 116, 125, 122], [118, 127, 133, 75, 114, 129, 122, 135, 68]),
    styleValue: decodeTileText([69, 65], [61], [66, 73]),
  };
}

function buildGoogleXyzTileConfig() {
  const layerCodes = {
    satellite: [[132]],
    hybrid: [[138]],
    road: [[126]],
    dark: [[126]],
    transit: [[126, 61, 133, 131, 114, 127, 132, 122, 133]],
  };
  const layerParam = decodeTileText([125, 138], [131, 132]);
  const googleDarkStyle = Buffer.from(
    'cy50JTNBMCU3Q3MuZSUzQWclN0NwLmMlM0ElMjNmZjFjMWMxYyUyQ3MudCUzQTYlN0NzLmUlM0FnJTdDcC5jJTNBJTIzZmYwZjIwM2QlMkNzLnQlM0E0MCU3Q3MuZSUzQWclN0NwLmMlM0ElMjNmZjE5MzAxOSUyQ3MudCUzQTgxJTdDcy5lJTNBZy5mJTdDcC5jJTNBJTIzZmYxYzFjMWMlMkNzLnQlM0E4MSU3Q3MuZSUzQWcucyU3Q3AuYyUzQSUyM2ZmM2QzZDNkJTJDcy50JTNBNjYlN0NzLmUlM0FnJTdDcC5jJTNBJTIzZmYyYTJiMzYlMkNzLnQlM0E2NSU3Q3MuZSUzQWclN0NwLmMlM0ElMjNmZjNjM2Y1NCUyQ3MudCUzQTMlN0NzLmUlM0FnJTdDcC5jJTNBJTIzZmYyODI4MjglMkNzLnQlM0EwJTdDcy5lJTNBbCU3Q3AudiUzQW9mZiUyQ3MudCUzQTElN0NzLmUlM0FsJTdDcC52JTNBb24lMkNzLnQlM0ExJTdDcy5lJTNBbC50LmYlN0NwLmMlM0ElMjNmZmUwZTBlMCUyQ3MudCUzQTElN0NzLmUlM0FsLnQucyU3Q3AudiUzQW9mZiUyQ3MudCUzQTQlN0NzLmUlM0FsJTdDcC52JTNBb24lMkNzLnQlM0E0JTdDcy5lJTNBbC50LmYlN0NwLmMlM0ElMjNmZmUwZTBlMCUyQ3MudCUzQTQlN0NzLmUlM0FsLnQucyU3Q3AudiUzQW9mZiUyQ3MudCUzQTY2JTdDcy5lJTNBbCU3Q3AudiUzQW9uJTJDcy50JTNBNjYlN0NzLmUlM0FsLnQuZiU3Q3AuYyUzQSUyM2ZmZTBlMGUwJTJDcy50JTNBNjYlN0NzLmUlM0FsLnQucyU3Q3AudiUzQW9mZiUyQ3MudCUzQTQwJTdDcy5lJTNBbCU3Q3AudiUzQW9uJTJDcy50JTNBNDAlN0NzLmUlM0FsLnQuZiU3Q3AuYyUzQSUyM2ZmZTBlMGUwJTJDcy50JTNBNDAlN0NzLmUlM0FsLnQucyU3Q3AudiUzQW9mZiUyQ3MudCUzQTM2JTdDcy5lJTNBbCU3Q3AudiUzQW9uJTJDcy50JTNBMzYlN0NzLmUlM0FsLnQuZiU3Q3AuYyUzQSUyM2ZmZTBlMGUwJTJDcy50JTNBMzYlN0NzLmUlM0FsLnQucyU3Q3AudiUzQW9mZg==',
    'base64',
  ).toString('utf8');

  return {
    host: decodeTileText([126, 133, 66, 63], [120, 128, 128, 120, 125], [118, 63, 116, 128, 126]),
    pathName: decodeTileText([135], [133]),
    layerQueries: Object.fromEntries(
      Object.entries(layerCodes).map(([variant, segments]) => {
        const layerToken = decodeTileText(...segments);
        const query = `${layerParam}=${encodeURIComponent(layerToken)}`;
        return [variant, variant === 'dark' ? `${query}&apistyle=${googleDarkStyle}` : query];
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

function getTileRequestHeaders(provider) {
  if (provider.resolver.kind === 'custom-template') {
    return provider.resolver.headers;
  }
  if (provider.resolver.kind === 'osm') {
    return {
      'user-agent': OSM_USER_AGENT,
    };
  }

  if (
    provider.resolver.kind !== 'streetview-availability' &&
    provider.resolver.kind !== 'google-xyz'
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

async function getGoogleSession() {
  const layer = 'satellite';
  const cached = googleSessions.get(layer);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.session;
  }

  const body = JSON.stringify({
    mapType: 'satellite',
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

function proxyImage(response, upstreamUrl, headers = {}, context = {}) {
  let activeRequest = null;
  let upstreamResponse = null;
  const requestUpstream = (url, requestHeaders, redirectCount) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'http:' ? http : https;
    const agent = parsedUrl.protocol === 'http:' ? proxyHttpAgent : proxyAgent;
    const upstreamRequest = client.get(parsedUrl, { agent, headers: requestHeaders }, (upstream) => {
      upstreamResponse = upstream;
      upstream.on('error', (error) => {
        sendUpstreamFailure(response, error, context);
      });

      const statusCode = upstream.statusCode || 500;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = upstream.headers.location;
        upstream.resume();
        if (!location || redirectCount >= MAX_UPSTREAM_REDIRECTS) {
          const error = new Error(location ? 'Too many upstream redirects' : 'Upstream redirect did not include a location');
          error.code = 'EREDIRECT';
          sendUpstreamFailure(response, error, context);
          return;
        }

        let redirectUrl;
        try {
          redirectUrl = new URL(location, parsedUrl);
        } catch {
          const error = new Error('Upstream returned an invalid redirect location');
          error.code = 'EREDIRECT';
          sendUpstreamFailure(response, error, context);
          return;
        }
        if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
          const error = new Error('Upstream redirect used an unsupported protocol');
          error.code = 'EREDIRECT';
          sendUpstreamFailure(response, error, context);
          return;
        }
        requestUpstream(
          redirectUrl,
          getRedirectHeaders(requestHeaders, parsedUrl, redirectUrl),
          redirectCount + 1,
        );
        return;
      }

      const contentType = upstream.headers['content-type'] || 'application/octet-stream';
      if (statusCode >= 300) {
        recordTileFailure(context, `status=${statusCode}`);
        upstream.resume();
        sendJson(response, statusCode >= 400 ? statusCode : 502, {
          error: 'upstream_error',
          status: statusCode,
        });
        return;
      }

      response.writeHead(statusCode, {
        'access-control-allow-origin': '*',
        'cache-control': TILE_CACHE_CONTROL,
        'content-type': contentType,
      });
      upstream.pipe(response);
    });
    activeRequest = upstreamRequest;
    upstreamRequest.setTimeout(UPSTREAM_REQUEST_TIMEOUT_MS, () => {
      const error = new Error(`Upstream request timed out after ${UPSTREAM_REQUEST_TIMEOUT_MS}ms`);
      error.code = 'ETIMEDOUT';
      upstreamRequest.destroy(error);
    });
    upstreamRequest.on('error', (error) => {
      sendUpstreamFailure(response, error, context);
    });
  };

  requestUpstream(upstreamUrl, headers, 0);

  response.on('close', () => {
    if (response.writableEnded) return;
    activeRequest?.destroy();
    upstreamResponse?.destroy();
  });
}

function getRedirectHeaders(headers, fromUrl, toUrl) {
  if (fromUrl.origin === toUrl.origin) return headers;
  const sensitiveHeaders = new Set(['authorization', 'cookie', 'proxy-authorization']);
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !sensitiveHeaders.has(name.toLowerCase())),
  );
}

function sendUpstreamFailure(response, error, context = {}) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy(error);
    return;
  }

  const statusCode = error.code === 'ETIMEDOUT' ? 504 : 502;
  recordTileFailure(context, `error=${sanitizeLogToken(error.code || error.name || 'request_failed')}`);
  sendJson(response, statusCode, { error: 'upstream_request_failed', message: 'Upstream tile request failed' });
}

function recordTileFailure(context, reason) {
  const provider = sanitizeLogToken(context.provider || 'unknown');
  const layer = sanitizeLogToken(context.layer || 'unknown');
  const key = `${provider}/${layer} ${reason}`;
  tileFailureCounts.set(key, (tileFailureCounts.get(key) || 0) + 1);
  scheduleTileFailureFlush();
}

function scheduleTileFailureFlush() {
  if (tileFailureFlushTimer !== null) return;
  tileFailureFlushTimer = setTimeout(() => {
    tileFailureFlushTimer = null;
    flushTileFailureLog();
  }, TILE_FAILURE_LOG_INTERVAL_MS);
  tileFailureFlushTimer.unref?.();
}

function flushTileFailureLog() {
  const entry = buildTileFailureLogEntry();
  if (!entry) return;
  proxyLogStream.write(entry);
}

function flushTileFailureLogSync() {
  const entry = buildTileFailureLogEntry();
  if (!entry) return;
  try {
    fs.appendFileSync(CURRENT_LOG_PATH, entry, 'utf8');
  } catch {
    // Process exit logging is best-effort.
  }
}

function buildTileFailureLogEntry() {
  if (!tileFailureCounts.size) return;
  const entries = [...tileFailureCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key} count=${count}`);
  tileFailureCounts.clear();
  return `[${new Date().toISOString()}] WARN Upstream tile failures: ${entries.join('; ')}\n`;
}

function sanitizeLogToken(value) {
  return String(value).replace(/[^a-zA-Z0-9_.=-]/g, '_').slice(0, 80);
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
  const anyConfigured = Object.values(providerStatus).some((provider) => (
    Object.values(provider.layers).some((layer) => layer.configured)
  ));
  return {
    ok: anyConfigured,
    ready: anyConfigured,
    status: anyConfigured ? 'ready' : 'No tile providers are configured.',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    providers: providerStatus,
  };
}

function buildProviderStatus() {
  return providerCatalog;
}

function loadCustomProviders() {
  let source;
  try {
    source = fs.readFileSync(CUSTOM_PROVIDERS_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      logProxyInfo(`[${new Date().toISOString()}] [proxy] No custom-providers.json found; no custom providers loaded.`);
      return [];
    }
    logCriticalError('Failed to read custom-providers.json', error);
    return [];
  }

  let payload;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    logCriticalError('Failed to parse custom-providers.json', error);
    return [];
  }

  const { providers: customProviders, errors } = parseCustomProviders(payload, process.env);
  errors.forEach((message) => logCriticalError('Invalid custom provider configuration', new Error(message)));
  if (customProviders.length === 0) {
    logProxyInfo(`[${new Date().toISOString()}] [proxy] custom-providers.json loaded with no valid providers.`);
  } else {
    const summary = customProviders.map((provider) => ({
      id: provider.id,
      label: provider.label,
      layer: Object.keys(provider.layers)[0],
      configured: provider.missingEnvironment?.length === 0,
    }));
    logProxyInfo(`[${new Date().toISOString()}] [proxy] Loaded custom providers: ${safeJson(summary)}`);
  }
  return customProviders;
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

function ensureProxyLogDirectory() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error('[proxy] Failed to create proxy log directory:', error);
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
  process.on('exit', () => {
    flushTileFailureLogSync();
  });

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
