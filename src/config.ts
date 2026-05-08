export const MOD_ID = 'com.orbital-surveyor.overlays';
export const MOD_NAME = 'Orbital Surveyor';
export const MOD_VERSION = '1.0.0';
export const TAG = '[OrbitalSurveyor]';

export type OverlayMode = 'base' | 'satellite' | 'terrain' | 'both';

export type ProviderLayer = 'satellite' | 'terrain';

export type ProviderOption = {
  id: string;
  label: string;
  layers: ProviderLayer[];
  attribution?: string;
};

export type SurveyorSettings = {
  proxyBaseUrl: string;
  mode: OverlayMode;
  satelliteProvider: string;
  terrainProvider: string;
  satelliteOpacity: number;
  terrainExaggeration: number;
};

export const DEFAULT_PROXY_BASE_URL = 'http://127.0.0.1:8787';

export const PROVIDERS: ProviderOption[] = [
  {
    id: 'google',
    label: 'Google Map Tiles',
    layers: ['satellite'],
    attribution: 'Imagery © Google',
  },
  {
    id: 'maptiler',
    label: 'MapTiler',
    layers: ['satellite', 'terrain'],
    attribution: '© MapTiler © OpenStreetMap contributors',
  },
  {
    id: 'custom',
    label: 'Custom Proxy',
    layers: ['satellite', 'terrain'],
  },
];

export const DEFAULT_SETTINGS: SurveyorSettings = {
  proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
  mode: 'base',
  satelliteProvider: 'maptiler',
  terrainProvider: 'maptiler',
  satelliteOpacity: 0.85,
  terrainExaggeration: 1.4,
};

export function normalizeProxyBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PROXY_BASE_URL;
  return trimmed.replace(/\/+$/, '');
}

export function mergeSettings(value: unknown): SurveyorSettings {
  const input = value && typeof value === 'object'
    ? value as Partial<SurveyorSettings> & { terrainOpacity?: number }
    : {};

  return {
    proxyBaseUrl: normalizeProxyBaseUrl(input.proxyBaseUrl ?? DEFAULT_SETTINGS.proxyBaseUrl),
    mode: isOverlayMode(input.mode) ? input.mode : DEFAULT_SETTINGS.mode,
    satelliteProvider: normalizeSatelliteProvider(input.satelliteProvider, input),
    terrainProvider: input.terrainProvider || DEFAULT_SETTINGS.terrainProvider,
    satelliteOpacity: normalizeOpacity(input.satelliteOpacity, DEFAULT_SETTINGS.satelliteOpacity),
    terrainExaggeration: normalizeExaggeration(
      input.terrainExaggeration ?? input.terrainOpacity,
      DEFAULT_SETTINGS.terrainExaggeration,
    ),
  };
}

function normalizeSatelliteProvider(
  value: unknown,
  input: Partial<SurveyorSettings> & { terrainOpacity?: number },
): string {
  if (typeof value !== 'string' || !value) return DEFAULT_SETTINGS.satelliteProvider;

  const looksLikeOldDefault =
    value === 'google' &&
    input.terrainProvider === undefined &&
    input.proxyBaseUrl === DEFAULT_SETTINGS.proxyBaseUrl &&
    input.satelliteOpacity === DEFAULT_SETTINGS.satelliteOpacity;

  return looksLikeOldDefault ? DEFAULT_SETTINGS.satelliteProvider : value;
}

function isOverlayMode(value: unknown): value is OverlayMode {
  return value === 'base' || value === 'satellite' || value === 'terrain' || value === 'both';
}

function normalizeOpacity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normalizeExaggeration(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(4, Math.max(0, value));
}
