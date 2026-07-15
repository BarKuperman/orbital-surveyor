import manifest from '../manifest.json';
import {
  DEFAULT_SATELLITE_PROVIDER,
  DEFAULT_TERRAIN_PROVIDER,
} from './providers';

export const MOD_ID = manifest.id;
export const MOD_NAME = manifest.name;
export const MOD_VERSION = manifest.version;
export const TAG = '[OrbitalSurveyor]';

export const CITY_LAYER_GROUPS = [
  { key: 'buildings', label: 'Buildings', layers: ['buildings-3d'] },
  { key: 'water', label: 'Water', layers: ['water', 'ocean-depth-labels', 'general-tiles'] },
  { key: 'parks', label: 'Parks', layers: ['parks-large', 'parks-small','parks-modded','commercial'] },
  { key: 'roads', label: 'Roads', layers: ['road-labels', 'intersections-layer', 'road-lines','road-bridge-casing','road-bridge-fill'] },
  { key: 'airports', label: 'Airports', layers: ['airports','runways-taxiways','airports-modded'] },
  { key: 'areaLabels', label: 'Area labels', layers: ['neighborhood-labels', 'suburb-labels', 'city-labels'] },
] as const;

export type CityLayerGroupKey = typeof CITY_LAYER_GROUPS[number]['key'];
export type CityLayerId = typeof CITY_LAYER_GROUPS[number]['layers'][number];
export type CityLayerVisibility = Record<CityLayerId, boolean>;

export type SurveyorSettings = {
  proxyBaseUrl: string;
  satelliteEnabled: boolean;
  terrainEnabled: boolean;
  streetViewEnabled: boolean;
  satelliteProvider: string;
  terrainProvider: string;
  satelliteOpacity: number;
  terrainExaggeration: number;
  cityLayers: CityLayerVisibility;
};

export const DEFAULT_PROXY_BASE_URL = 'http://127.0.0.1:8787';

export const DEFAULT_CITY_LAYERS = CITY_LAYER_GROUPS.reduce((visibility, group) => {
  group.layers.forEach((layerId) => {
    visibility[layerId] = false;
  });
  return visibility;
}, {} as CityLayerVisibility);

export const DEFAULT_SETTINGS: SurveyorSettings = {
  proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
  satelliteEnabled: false,
  terrainEnabled: false,
  streetViewEnabled: false,
  satelliteProvider: DEFAULT_SATELLITE_PROVIDER,
  terrainProvider: DEFAULT_TERRAIN_PROVIDER,
  satelliteOpacity: 1,
  terrainExaggeration: 1.4,
  cityLayers: { ...DEFAULT_CITY_LAYERS },
};

export function normalizeProxyBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PROXY_BASE_URL;
  return trimmed.replace(/\/+$/, '');
}

export function mergeSettings(value: unknown): SurveyorSettings {
  const input = value && typeof value === 'object'
    ? value as Partial<SurveyorSettings> & LegacySettings
    : {};

  return {
    proxyBaseUrl: normalizeProxyBaseUrl(input.proxyBaseUrl ?? DEFAULT_SETTINGS.proxyBaseUrl),
    satelliteEnabled: normalizeBoolean(input.satelliteEnabled, DEFAULT_SETTINGS.satelliteEnabled),
    terrainEnabled: normalizeBoolean(input.terrainEnabled, DEFAULT_SETTINGS.terrainEnabled),
    streetViewEnabled: normalizeBoolean(input.streetViewEnabled, DEFAULT_SETTINGS.streetViewEnabled),
    satelliteProvider: normalizeSatelliteProvider(input.satelliteProvider, input),
    terrainProvider: normalizeProvider(input.terrainProvider, DEFAULT_SETTINGS.terrainProvider),
    satelliteOpacity: normalizeOpacity(input.satelliteOpacity, DEFAULT_SETTINGS.satelliteOpacity),
    terrainExaggeration: normalizeExaggeration(
      input.terrainExaggeration ?? input.terrainOpacity,
      DEFAULT_SETTINGS.terrainExaggeration,
    ),
    cityLayers: normalizeCityLayers(input.cityLayers),
  };
}

function normalizeSatelliteProvider(
  value: unknown,
  input: Partial<SurveyorSettings> & LegacySettings,
): string {
  if (typeof value !== 'string' || !value) return DEFAULT_SETTINGS.satelliteProvider;

  const looksLikeOldDefault =
    value === 'google' &&
    input.terrainProvider === undefined &&
    input.proxyBaseUrl === DEFAULT_SETTINGS.proxyBaseUrl &&
    input.satelliteOpacity === 1;

  return looksLikeOldDefault
    ? DEFAULT_SETTINGS.satelliteProvider
    : normalizeProvider(value, DEFAULT_SETTINGS.satelliteProvider);
}

function normalizeProvider(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value) return fallback;
  return value;
}

type LegacySettings = {
  satelliteOpacity?: number;
  terrainOpacity?: number;
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeOpacity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normalizeExaggeration(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(4, Math.max(0, value));
}

function normalizeCityLayers(value: unknown): CityLayerVisibility {
  const input = value && typeof value === 'object'
    ? value as Partial<Record<CityLayerGroupKey | CityLayerId, unknown>>
    : {};
  const cityLayers: CityLayerVisibility = { ...DEFAULT_CITY_LAYERS };

  CITY_LAYER_GROUPS.forEach((group) => {
    const groupVisible = input[group.key];
    group.layers.forEach((layerId) => {
      const visible = input[layerId] ?? groupVisible;
      cityLayers[layerId] = typeof visible === 'boolean' ? visible : DEFAULT_CITY_LAYERS[layerId];
    });
  });

  return cityLayers;
}
