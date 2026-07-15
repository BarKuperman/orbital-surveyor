export type ProviderLayer = 'satellite' | 'terrain' | 'availability';
export type SelectableProviderLayer = 'satellite' | 'terrain';
export type TerrainEncoding = 'mapbox' | 'terrarium';
export type ProviderAvailabilityReason =
  | 'missing_environment'
  | 'invalid_configuration'
  | 'unsupported_layer'
  | 'upstream_unreachable'
  | 'provider_unavailable';

export type ProviderLayerMetadata = {
  attribution: string;
  tileSize: 256 | 512;
  maxZoom?: number;
  encoding?: TerrainEncoding;
};

export type ProviderCatalogLayer = ProviderLayerMetadata & {
  configured: boolean;
  availabilityReason?: ProviderAvailabilityReason;
};

export type ProviderIssue = {
  id: string;
  label: string;
  layer: SelectableProviderLayer;
  reason: 'invalid_configuration';
};

export type ProviderCatalogEntry = {
  id: string;
  label: string;
  selectable: boolean;
  layers: Partial<Record<ProviderLayer, ProviderCatalogLayer>>;
};

export type ProviderCatalog = Record<string, ProviderCatalogEntry>;

export type ProviderResolver =
  | { kind: 'streetview-availability' }
  | { kind: 'google-xyz'; variant: 'satellite' | 'hybrid' | 'road' | 'dark' | 'transit' }
  | { kind: 'google-map-tiles' }
  | { kind: 'maptiler' }
  | { kind: 'mapterhorn' }
  | { kind: 'esri' }
  | { kind: 'osm' }
  | { kind: 'custom-template'; urlTemplate: string; headers: Record<string, string> };

export type ProviderDefinition = {
  id: string;
  label: string;
  selectable: boolean;
  defaultFor?: SelectableProviderLayer;
  layers: Partial<Record<ProviderLayer, ProviderLayerMetadata>>;
  requiredEnvironment?: string[];
  missingEnvironment?: string[];
  resolver: ProviderResolver;
};

const googleRaster = (attribution = 'Tiles © Google'): ProviderLayerMetadata => ({
  attribution,
  tileSize: 256,
});

export const BUILTIN_PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: 'streetview',
    label: 'Google Street View',
    selectable: false,
    layers: { availability: googleRaster('Street View © Google') },
    resolver: { kind: 'streetview-availability' },
  },
  {
    id: 'google-sat',
    label: 'Google Satellite',
    selectable: true,
    defaultFor: 'satellite',
    layers: { satellite: googleRaster() },
    resolver: { kind: 'google-xyz', variant: 'satellite' },
  },
  {
    id: 'google-hybrid',
    label: 'Google Hybrid',
    selectable: true,
    layers: { satellite: googleRaster() },
    resolver: { kind: 'google-xyz', variant: 'hybrid' },
  },
  {
    id: 'google-road',
    label: 'Google Roads',
    selectable: true,
    layers: { satellite: googleRaster() },
    resolver: { kind: 'google-xyz', variant: 'road' },
  },
  {
    id: 'google-dark',
    label: 'Google Dark',
    selectable: true,
    layers: { satellite: googleRaster() },
    resolver: { kind: 'google-xyz', variant: 'dark' },
  },
  {
    id: 'google-transit',
    label: 'Google Transit',
    selectable: true,
    layers: { satellite: googleRaster() },
    resolver: { kind: 'google-xyz', variant: 'transit' },
  },
  {
    id: 'esri',
    label: 'Esri World Imagery',
    selectable: true,
    layers: { satellite: { attribution: 'Tiles © Esri', tileSize: 256 } },
    resolver: { kind: 'esri' },
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    selectable: true,
    layers: { satellite: { attribution: 'Tiles © OpenStreetMap contributors', tileSize: 256, maxZoom: 19 } },
    resolver: { kind: 'osm' },
  },
  {
    id: 'google',
    label: 'Google Map Tiles (API key)',
    selectable: true,
    layers: { satellite: googleRaster() },
    requiredEnvironment: ['GOOGLE_MAPS_API_KEY'],
    resolver: { kind: 'google-map-tiles' },
  },
  {
    id: 'maptiler',
    label: 'MapTiler (API key)',
    selectable: true,
    layers: {
      satellite: { attribution: 'Tiles © MapTiler', tileSize: 256 },
      terrain: { attribution: 'Terrain © MapTiler', tileSize: 256, maxZoom: 14, encoding: 'mapbox' },
    },
    requiredEnvironment: ['MAPTILER_API_KEY'],
    resolver: { kind: 'maptiler' },
  },
  {
    id: 'mapterhorn',
    label: 'Mapterhorn',
    selectable: true,
    defaultFor: 'terrain',
    layers: {
      terrain: { attribution: 'Terrain © Mapterhorn', tileSize: 512, maxZoom: 17, encoding: 'terrarium' },
    },
    resolver: { kind: 'mapterhorn' },
  },
] as const;

export const DEFAULT_SATELLITE_PROVIDER = resolveDefaultProvider('satellite');
export const DEFAULT_TERRAIN_PROVIDER = resolveDefaultProvider('terrain');
export const BUILTIN_PROVIDER_CATALOG = createProviderCatalog(BUILTIN_PROVIDERS);

const BLOCKED_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const XYZ_PLACEHOLDERS = new Set(['x', 'y', 'z']);

export function resolveDefaultProvider(layer: SelectableProviderLayer): string {
  const provider = BUILTIN_PROVIDERS.find((candidate) => candidate.defaultFor === layer);
  if (!provider) throw new Error(`No default ${layer} provider is configured`);
  return provider.id;
}

export function createProviderCatalog(
  definitions: readonly ProviderDefinition[],
  environment?: Record<string, string | undefined>,
): ProviderCatalog {
  return Object.fromEntries(definitions.map((provider) => {
    const required = [...(provider.requiredEnvironment ?? []), ...(provider.missingEnvironment ?? [])];
    const configured = environment === undefined
      ? provider.missingEnvironment?.length !== 0
      : required.every((name) => Boolean(environment[name]));
    const layers = Object.fromEntries(
      Object.entries(provider.layers).map(([layer, metadata]) => [
        layer,
        {
          ...metadata,
          configured,
          ...(!configured ? { availabilityReason: 'missing_environment' as const } : {}),
        },
      ]),
    ) as ProviderCatalogEntry['layers'];
    return [provider.id, {
      id: provider.id,
      label: provider.label,
      selectable: provider.selectable,
      layers,
    }];
  }));
}

export function mergeProviderCatalog(value: unknown): ProviderCatalog {
  const catalog: ProviderCatalog = { ...BUILTIN_PROVIDER_CATALOG };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return catalog;

  for (const [id, rawEntry] of Object.entries(value)) {
    const entry = normalizeCatalogEntry(id, rawEntry);
    if (entry) catalog[id] = entry;
  }
  return catalog;
}

export function getProviderLayer(
  catalog: ProviderCatalog,
  providerId: string,
  layer: ProviderLayer,
): ProviderCatalogLayer | undefined {
  return catalog[providerId]?.layers[layer];
}

export function isProviderLayerConfigured(
  catalog: ProviderCatalog,
  providerId: string,
  layer: ProviderLayer,
): boolean {
  return getProviderLayer(catalog, providerId, layer)?.configured === true;
}

export function parseCustomProviders(
  value: unknown,
  environment: Record<string, string | undefined>,
  reservedIds: ReadonlySet<string> = new Set(BUILTIN_PROVIDERS.map((provider) => provider.id)),
): { providers: ProviderDefinition[]; errors: string[]; issues: ProviderIssue[] } {
  if (!Array.isArray(value)) {
    return { providers: [], errors: ['custom-providers.json must contain a JSON array'], issues: [] };
  }

  const providers: ProviderDefinition[] = [];
  const errors: string[] = [];
  const issues: ProviderIssue[] = [];
  const seenIds = new Set(reservedIds);
  const seenIssueIds = new Set<string>();

  value.forEach((entry, index) => {
    const result = parseCustomProvider(entry, index, environment, seenIds);
    if ('error' in result) {
      errors.push(result.error);
      const issue = normalizeCustomProviderIssue(entry, seenIds);
      if (issue && !seenIssueIds.has(issue.id)) {
        issues.push(issue);
        seenIssueIds.add(issue.id);
      }
      return;
    }
    providers.push(result.provider);
    seenIds.add(result.provider.id);
  });

  return { providers, errors, issues };
}

export function normalizeProviderIssues(value: unknown): ProviderIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: ProviderIssue[] = [];
  const seenIds = new Set<string>();
  for (const rawIssue of value) {
    if (!rawIssue || typeof rawIssue !== 'object' || Array.isArray(rawIssue)) continue;
    const issue = rawIssue as Record<string, unknown>;
    if (typeof issue.id !== 'string' || !PROVIDER_ID_PATTERN.test(issue.id) || seenIds.has(issue.id)) continue;
    if (typeof issue.label !== 'string' || !issue.label.trim()) continue;
    if (issue.layer !== 'satellite' && issue.layer !== 'terrain') continue;
    if (issue.reason !== 'invalid_configuration') continue;
    issues.push({ id: issue.id, label: issue.label.trim(), layer: issue.layer, reason: issue.reason });
    seenIds.add(issue.id);
  }
  return issues;
}

export function formatProviderAvailabilityReason(reason: ProviderAvailabilityReason): string {
  switch (reason) {
    case 'missing_environment': return 'Missing API key';
    case 'invalid_configuration': return 'Invalid configuration';
    case 'unsupported_layer': return 'Unsupported layer';
    case 'upstream_unreachable': return 'Upstream unreachable';
    case 'provider_unavailable': return 'Provider unavailable';
  }
}

function parseCustomProvider(
  value: unknown,
  index: number,
  environment: Record<string, string | undefined>,
  seenIds: ReadonlySet<string>,
): { provider: ProviderDefinition } | { error: string } {
  const prefix = `Custom provider at index ${index}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: `${prefix} must be an object` };
  const input = value as Record<string, unknown>;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!PROVIDER_ID_PATTERN.test(id)) return { error: `${prefix} has an invalid id` };
  if (seenIds.has(id)) return { error: `${prefix} uses duplicate or reserved id "${id}"` };

  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const attribution = typeof input.attribution === 'string' ? input.attribution.trim() : '';
  if (!label) return { error: `${prefix} must have a label` };
  if (!attribution) return { error: `${prefix} must have attribution` };
  if (input.layer !== 'satellite' && input.layer !== 'terrain') return { error: `${prefix} must use layer "satellite" or "terrain"` };
  const layer = input.layer;

  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) return { error: `${prefix} must have a URL template` };
  const environmentBindings = normalizeEnvironmentBindings(input.environment, prefix);
  if ('error' in environmentBindings) return environmentBindings;
  const placeholders = collectPlaceholders(url);
  if (!['x', 'y', 'z'].every((placeholder) => placeholders.has(placeholder))) {
    return { error: `${prefix} URL must contain {z}, {x}, and {y}` };
  }
  const unknownPlaceholder = [...placeholders].find((placeholder) => (
    !XYZ_PLACEHOLDERS.has(placeholder) && !(placeholder in environmentBindings.bindings)
  ));
  if (unknownPlaceholder) return { error: `${prefix} uses undeclared placeholder {${unknownPlaceholder}}` };

  const testUrl = substituteEnvironment(url, environmentBindings.bindings, environment, true)
    .replace(/\{[zxy]\}/g, '0');
  let protocol = '';
  try {
    protocol = new URL(testUrl).protocol;
  } catch {
    return { error: `${prefix} has an invalid URL template` };
  }
  if (protocol !== 'http:' && protocol !== 'https:') return { error: `${prefix} URL must use HTTP or HTTPS` };

  const headers = normalizeRequestHeaders(input.request, environmentBindings.bindings, environment, prefix);
  if ('error' in headers) return headers;
  const tileSize = input.tileSize === undefined ? 256 : input.tileSize;
  if (tileSize !== 256 && tileSize !== 512) return { error: `${prefix} tileSize must be 256 or 512` };
  const maxZoom = input.maxZoom;
  if (maxZoom !== undefined && (!Number.isInteger(maxZoom) || Number(maxZoom) < 0 || Number(maxZoom) > 24)) {
    return { error: `${prefix} maxZoom must be an integer from 0 through 24` };
  }
  if (layer === 'terrain' && input.encoding !== 'mapbox' && input.encoding !== 'terrarium') {
    return { error: `${prefix} terrain provider must use encoding "mapbox" or "terrarium"` };
  }

  const missingEnvironment = Object.values(environmentBindings.bindings)
    .filter((name) => !environment[name]);
  const metadata: ProviderLayerMetadata = {
    attribution,
    tileSize,
    ...(maxZoom === undefined ? {} : { maxZoom: Number(maxZoom) }),
    ...(layer === 'terrain' ? { encoding: input.encoding as TerrainEncoding } : {}),
  };
  return {
    provider: {
      id,
      label,
      selectable: true,
      layers: { [layer]: metadata },
      missingEnvironment,
      resolver: {
        kind: 'custom-template',
        urlTemplate: substituteEnvironment(url, environmentBindings.bindings, environment, true),
        headers: headers.headers,
      },
    },
  };
}

function normalizeCustomProviderIssue(value: unknown, seenIds: ReadonlySet<string>): ProviderIssue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!PROVIDER_ID_PATTERN.test(id) || seenIds.has(id) || !label) return null;
  if (input.layer !== 'satellite' && input.layer !== 'terrain') return null;
  return { id, label, layer: input.layer, reason: 'invalid_configuration' };
}

function normalizeEnvironmentBindings(
  value: unknown,
  prefix: string,
): { bindings: Record<string, string> } | { error: string } {
  if (value === undefined) return { bindings: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: `${prefix} environment must be an object` };
  const bindings: Record<string, string> = {};
  for (const [placeholder, rawName] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(placeholder) || XYZ_PLACEHOLDERS.has(placeholder)) {
      return { error: `${prefix} has invalid environment placeholder "${placeholder}"` };
    }
    if (typeof rawName !== 'string' || !ENVIRONMENT_NAME_PATTERN.test(rawName)) {
      return { error: `${prefix} has invalid environment variable for "${placeholder}"` };
    }
    bindings[placeholder] = rawName;
  }
  return { bindings };
}

function normalizeRequestHeaders(
  value: unknown,
  bindings: Record<string, string>,
  environment: Record<string, string | undefined>,
  prefix: string,
): { headers: Record<string, string> } | { error: string } {
  if (value === undefined) return { headers: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: `${prefix} request must be an object` };
  const headersValue = (value as Record<string, unknown>).headers;
  if (headersValue === undefined) return { headers: {} };
  if (!headersValue || typeof headersValue !== 'object' || Array.isArray(headersValue)) {
    return { error: `${prefix} request.headers must be an object` };
  }
  const headers: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(headersValue)) {
    if (!HEADER_NAME_PATTERN.test(name) || BLOCKED_REQUEST_HEADERS.has(name.toLowerCase())) {
      return { error: `${prefix} uses forbidden request header "${name}"` };
    }
    if (typeof rawValue !== 'string' || /[\u0000-\u001f\u007f]/.test(rawValue)) {
      return { error: `${prefix} has invalid value for request header "${name}"` };
    }
    const placeholders = collectPlaceholders(rawValue);
    const unknown = [...placeholders].find((placeholder) => !(placeholder in bindings));
    if (unknown) return { error: `${prefix} header "${name}" uses undeclared placeholder {${unknown}}` };
    headers[name] = substituteEnvironment(rawValue, bindings, environment, false);
  }
  return { headers };
}

function substituteEnvironment(
  template: string,
  bindings: Record<string, string>,
  environment: Record<string, string | undefined>,
  encode: boolean,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (match, placeholder: string) => {
    if (XYZ_PLACEHOLDERS.has(placeholder)) return match;
    const variableName = bindings[placeholder];
    if (!variableName) return match;
    const resolved = environment[variableName];
    if (!resolved) return match;
    return encode ? encodeURIComponent(resolved) : resolved;
  });
}

function collectPlaceholders(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]));
}

function normalizeCatalogEntry(id: string, value: unknown): ProviderCatalogEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.id !== id || typeof input.label !== 'string' || typeof input.selectable !== 'boolean') return null;
  if (!input.layers || typeof input.layers !== 'object' || Array.isArray(input.layers)) return null;
  const layers: ProviderCatalogEntry['layers'] = {};
  for (const layer of ['satellite', 'terrain', 'availability'] as const) {
    const rawLayer = (input.layers as Record<string, unknown>)[layer];
    if (!rawLayer || typeof rawLayer !== 'object' || Array.isArray(rawLayer)) continue;
    const metadata = rawLayer as Record<string, unknown>;
    if (typeof metadata.attribution !== 'string' || (metadata.tileSize !== 256 && metadata.tileSize !== 512)) continue;
    if (typeof metadata.configured !== 'boolean') continue;
    if (metadata.maxZoom !== undefined && typeof metadata.maxZoom !== 'number') continue;
    if (layer === 'terrain' && metadata.encoding !== 'mapbox' && metadata.encoding !== 'terrarium') continue;
    layers[layer] = {
      attribution: metadata.attribution,
      tileSize: metadata.tileSize,
      configured: metadata.configured,
      ...(
        !metadata.configured && metadata.availabilityReason === 'missing_environment'
          ? { availabilityReason: metadata.availabilityReason }
          : {}
      ),
      ...(typeof metadata.maxZoom === 'number' ? { maxZoom: metadata.maxZoom } : {}),
      ...(layer === 'terrain' ? { encoding: metadata.encoding as TerrainEncoding } : {}),
    };
  }
  if (!Object.keys(layers).length) return null;
  return { id, label: input.label, selectable: input.selectable, layers };
}
