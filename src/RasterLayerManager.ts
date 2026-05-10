import type { SurveyorSettings } from './config';

type MapLike = {
  on: (type: string, listener: () => void) => void;
  off: (type: string, listener: () => void) => void;
  getSource: (id: string) => unknown;
  addSource: (id: string, source: Record<string, unknown>) => void;
  removeSource: (id: string) => void;
  getLayer: (id: string) => unknown;
  addLayer: (layer: Record<string, unknown>, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  setLayoutProperty: (layerId: string, name: string, value: unknown) => void;
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
  moveLayer: (layerId: string, beforeId?: string) => void;
  getStyle: () => { layers?: Array<{ id: string; source?: string }>; sources?: Record<string, unknown> };
  isStyleLoaded?: () => boolean | void;
  setStyle?: (style: unknown, options?: unknown) => unknown;
  setTerrain?: (terrain: { source: string; exaggeration?: number } | null) => void;
  getTerrain?: () => { source: string; exaggeration?: number } | null;
};

const SATELLITE_SOURCE_ID = 'orbital-surveyor-satellite-source';
const SATELLITE_LAYER_ID = 'orbital-surveyor-satellite-layer';
const TERRAIN_DEM_SOURCE_ID = 'orbital-surveyor-terrain-dem-source';
const GAME_BASE_SOURCE_IDS = ['general-tiles'];

const ORDER_ANCHORS = [
  'track-elevations',
  'tracks',
  'blueprint-tracks',
  'stations',
  'station-labels',
  'routes',
  'trains',
  'demand-points',
  'road-labels',
];

type LayerDefinition = {
  sourceId: string;
  layerId: string;
  providerId: string;
  layerName: 'satellite' | 'terrain';
  opacity: number;
  visible: boolean;
  attribution?: string;
};

type TerrainDefinition = {
  sourceId: string;
  providerId: string;
  exaggeration: number;
  enabled: boolean;
};

type TerrainSourceProfile = {
  encoding: 'mapbox' | 'terrarium';
  tileSize: number;
  maxzoom: number;
  attribution: string;
};

export class RasterLayerManager {
  private map: MapLike | null = null;
  private settings: SurveyorSettings | null = null;
  private styleHandler: (() => void) | null = null;
  private styleLoadingHandler: (() => void) | null = null;
  private dataHandler: (() => void) | null = null;
  private lastSourceKeys = new Map<string, string>();
  private ensureTimer: number | null = null;
  private patchedMap: MapLike | null = null;
  private originalSetStyle: MapLike['setStyle'] | null = null;
  private warnedKeys = new Set<string>();

  setMap(map: MapLike): void {
    if (this.map === map) return;
    this.detachHandlers();
    this.map = map;
    this.patchSetStyle();
    this.attachHandlers();
    this.ensureLayers();
  }

  setSettings(settings: SurveyorSettings): void {
    this.settings = { ...settings };
    this.ensureLayers();
  }

  reset(): void {
    this.clearScheduledEnsure();
    this.disableTerrain();
    this.removeSource(TERRAIN_DEM_SOURCE_ID);
    this.removeLayer(SATELLITE_LAYER_ID, SATELLITE_SOURCE_ID);
    this.lastSourceKeys.clear();
  }

  destroy(): void {
    this.detachHandlers();
    this.reset();
    this.restoreSetStyle();
    this.map = null;
  }

  private attachHandlers(): void {
    if (!this.map) return;
    this.styleHandler = () => this.onStyleData();
    this.styleLoadingHandler = () => this.onStyleLoading();
    this.dataHandler = () => this.reorderLayers();
    this.map.on('styledata', this.styleHandler);
    this.map.on('styledataloading', this.styleLoadingHandler);
    this.map.on('data', this.dataHandler);
  }

  private detachHandlers(): void {
    if (!this.map) return;
    if (this.styleHandler) {
      this.map.off('styledata', this.styleHandler);
      this.styleHandler = null;
    }
    if (this.styleLoadingHandler) {
      this.map.off('styledataloading', this.styleLoadingHandler);
      this.styleLoadingHandler = null;
    }
    if (this.dataHandler) {
      this.map.off('data', this.dataHandler);
      this.dataHandler = null;
    }
    this.clearScheduledEnsure();
    this.restoreSetStyle();
  }

  private ensureLayers(): void {
    if (!this.map || !this.settings) return;
    if (!this.isStyleReady()) {
      this.scheduleEnsureLayers();
      return;
    }

    const satelliteVisible = this.settings.mode === 'satellite' || this.settings.mode === 'both';
    const terrainEnabled = this.settings.mode === 'terrain' || this.settings.mode === 'both';

    this.ensureRasterLayer({
      sourceId: SATELLITE_SOURCE_ID,
      layerId: SATELLITE_LAYER_ID,
      providerId: this.settings.satelliteProvider,
      layerName: 'satellite',
      opacity: this.settings.satelliteOpacity,
      visible: satelliteVisible,
      attribution: 'Imagery © Google',
    });

    this.ensureTerrain({
      sourceId: TERRAIN_DEM_SOURCE_ID,
      providerId: this.settings.terrainProvider,
      exaggeration: this.settings.terrainExaggeration,
      enabled: terrainEnabled,
    });

    this.reorderLayers();
  }

  private ensureRasterLayer(definition: LayerDefinition): void {
    if (!this.map || !this.settings) return;

    const sourceKey = `${this.settings.proxyBaseUrl}|${definition.providerId}|${definition.layerName}`;
    if (this.lastSourceKeys.get(definition.sourceId) !== sourceKey) {
      this.removeLayer(definition.layerId, definition.sourceId);
      this.lastSourceKeys.set(definition.sourceId, sourceKey);
    }

    if (!this.hasSource(definition.sourceId)) {
      if (!this.addSource(definition.sourceId, {
        type: 'raster',
        tiles: [this.buildTileUrl(definition.providerId, definition.layerName)],
        tileSize: 256,
        attribution: definition.attribution,
      })) {
        return;
      }
    }

    if (!this.hasLayer(definition.layerId)) {
      this.addLayer(
        {
          id: definition.layerId,
          type: 'raster',
          source: definition.sourceId,
          layout: {
            visibility: definition.visible ? 'visible' : 'none',
          },
          paint: {
            'raster-opacity': definition.opacity,
          },
        },
        this.findBeforeLayerId(),
      );
    } else {
      this.setLayoutProperty(
        definition.layerId,
        'visibility',
        definition.visible ? 'visible' : 'none',
      );
      this.setPaintProperty(definition.layerId, 'raster-opacity', definition.opacity);
    }
  }

  private ensureTerrain(definition: TerrainDefinition): void {
    if (!this.map || !this.settings) return;

    const sourceProfile = this.resolveTerrainSourceProfile(definition.providerId);
    const sourceKey = `${this.settings.proxyBaseUrl}|${definition.providerId}|${sourceProfile.encoding}|${sourceProfile.tileSize}`;
    if (this.lastSourceKeys.get(definition.sourceId) !== sourceKey) {
      this.disableTerrain();
      this.removeSource(definition.sourceId);
      this.lastSourceKeys.set(definition.sourceId, sourceKey);
    }

    if (!definition.enabled) {
      this.disableTerrain();
      return;
    }

    if (!this.hasSource(definition.sourceId)) {
      if (!this.addSource(definition.sourceId, {
        type: 'raster-dem',
        tiles: [this.buildTileUrl(definition.providerId, 'terrain')],
        tileSize: sourceProfile.tileSize,
        maxzoom: sourceProfile.maxzoom,
        encoding: sourceProfile.encoding,
        attribution: sourceProfile.attribution,
      })) {
        this.scheduleEnsureLayers();
        return;
      }
    }

    if (!this.map.setTerrain) {
      console.warn('[OrbitalSurveyor] MapLibre terrain API is not available on this map instance');
      return;
    }

    if (!this.hasSource(definition.sourceId)) {
      this.disableTerrain();
      this.scheduleEnsureLayers();
      return;
    }

    const activeTerrain = this.getActiveTerrain();
    if (
      activeTerrain?.source === definition.sourceId &&
      activeTerrain.exaggeration === definition.exaggeration
    ) {
      return;
    }

    this.setTerrain({
      source: definition.sourceId,
      exaggeration: definition.exaggeration,
    });
  }

  private buildTileUrl(providerId: string, layerName: 'satellite' | 'terrain'): string {
    const proxyBaseUrl = this.settings?.proxyBaseUrl ?? '';
    return `${proxyBaseUrl}/tiles/${encodeURIComponent(providerId)}/${layerName}/{z}/{x}/{y}`;
  }

  private reorderLayers(): void {
    if (!this.map) return;
    const beforeId = this.findBeforeLayerId();
    [SATELLITE_LAYER_ID].forEach((layerId) => {
      if (!this.hasLayer(layerId)) return;
      this.moveLayer(layerId, beforeId);
    });
  }

  private findBeforeLayerId(): string | undefined {
    if (!this.map) return undefined;
    try {
      const layerIds = this.map.getStyle().layers?.map((layer) => layer.id) ?? [];
      return ORDER_ANCHORS.find((layerId) => layerIds.includes(layerId));
    } catch (error) {
      this.warnOnce('getStyle', '[OrbitalSurveyor] Failed to inspect map style', error);
      return undefined;
    }
  }

  private removeLayer(layerId: string, sourceId: string): void {
    if (!this.map) return;
    if (this.hasLayer(layerId)) {
      this.removeLayerOnly(layerId);
    }
    if (this.hasSource(sourceId)) {
      this.removeSource(sourceId);
    }
  }

  private disableTerrain(): void {
    if (!this.map?.setTerrain) return;
    if (this.map.getTerrain && !this.getActiveTerrain()) return;
    this.setTerrain(null);
  }

  private removeSource(sourceId: string): void {
    if (!this.map) return;
    if (this.hasSource(sourceId)) {
      try {
        this.map.removeSource(sourceId);
      } catch (error) {
        this.warnOnce(`removeSource:${sourceId}`, `[OrbitalSurveyor] Failed to remove source ${sourceId}`, error);
      }
    }
  }

  private onStyleLoading(): void {
    this.disableTerrain();
  }

  private onStyleData(): void {
    if (!this.map) return;
    if (this.getActiveTerrain()?.source === TERRAIN_DEM_SOURCE_ID && !this.hasSource(TERRAIN_DEM_SOURCE_ID)) {
      this.disableTerrain();
    }
    this.scheduleEnsureLayers();
  }

  private patchSetStyle(): void {
    if (!this.map || this.patchedMap === this.map) return;
    const setStyle = this.map.setStyle;
    if (!setStyle) return;
    this.restoreSetStyle();

    const map = this.map;
    const originalSetStyle = setStyle.bind(map);
    this.originalSetStyle = setStyle;
    this.patchedMap = map;

    map.setStyle = (style: unknown, options?: unknown): unknown => {
      this.disableTerrain();
      this.clearScheduledEnsure();
      const result = originalSetStyle(this.restoreMissingGameSources(style), options);
      this.scheduleEnsureLayers();
      return result;
    };
  }

  private restoreMissingGameSources(style: unknown): unknown {
    if (!style || typeof style !== 'object' || Array.isArray(style) || !this.map) {
      return style;
    }

    const nextStyle = style as {
      sources?: Record<string, unknown>;
      layers?: Array<{ source?: string }>;
    };
    if (!nextStyle.layers?.length) return style;

    const missingSourceIds = GAME_BASE_SOURCE_IDS.filter((sourceId) => (
      nextStyle.layers?.some((layer) => layer.source === sourceId) &&
      !nextStyle.sources?.[sourceId]
    ));
    if (!missingSourceIds.length) return style;

    let currentSources: Record<string, unknown> | undefined;
    try {
      currentSources = this.map.getStyle().sources;
    } catch (error) {
      this.warnOnce('restoreGameSources:getStyle', '[OrbitalSurveyor] Failed to inspect current game sources', error);
      return style;
    }

    const restoredSources = Object.fromEntries(
      missingSourceIds
        .map((sourceId) => [sourceId, currentSources?.[sourceId]] as const)
        .filter(([, source]) => Boolean(source)),
    );
    if (!Object.keys(restoredSources).length) {
      this.warnOnce(
        'restoreGameSources:missing',
        `[OrbitalSurveyor] Game style is missing required source(s): ${missingSourceIds.join(', ')}`,
        new Error('No matching source found in current style'),
      );
      return style;
    }

    return {
      ...nextStyle,
      sources: {
        ...nextStyle.sources,
        ...restoredSources,
      },
    };
  }

  private restoreSetStyle(): void {
    if (!this.patchedMap || !this.originalSetStyle) return;
    this.patchedMap.setStyle = this.originalSetStyle;
    this.patchedMap = null;
    this.originalSetStyle = null;
  }

  private scheduleEnsureLayers(): void {
    if (this.ensureTimer !== null) return;
    this.ensureTimer = window.setTimeout(() => {
      this.ensureTimer = null;
      this.ensureLayers();
    }, 100);
  }

  private clearScheduledEnsure(): void {
    if (this.ensureTimer === null) return;
    window.clearTimeout(this.ensureTimer);
    this.ensureTimer = null;
  }

  private isStyleReady(): boolean {
    if (!this.map?.isStyleLoaded) return true;
    try {
      return this.map.isStyleLoaded() !== false;
    } catch (error) {
      this.warnOnce('isStyleLoaded', '[OrbitalSurveyor] Failed to read style load state', error);
      return false;
    }
  }

  private hasSource(sourceId: string): boolean {
    if (!this.map) return false;
    try {
      return Boolean(this.map.getSource(sourceId));
    } catch (error) {
      this.warnOnce(`getSource:${sourceId}`, `[OrbitalSurveyor] Failed to read source ${sourceId}`, error);
      return false;
    }
  }

  private hasLayer(layerId: string): boolean {
    if (!this.map) return false;
    try {
      return Boolean(this.map.getLayer(layerId));
    } catch (error) {
      this.warnOnce(`getLayer:${layerId}`, `[OrbitalSurveyor] Failed to read layer ${layerId}`, error);
      return false;
    }
  }

  private getActiveTerrain(): { source: string; exaggeration?: number } | null {
    if (!this.map?.getTerrain) return null;
    try {
      return this.map.getTerrain();
    } catch (error) {
      this.warnOnce('getTerrain', '[OrbitalSurveyor] Failed to read active terrain', error);
      return null;
    }
  }

  private addSource(sourceId: string, source: Record<string, unknown>): boolean {
    if (!this.map) return false;
    try {
      this.map.addSource(sourceId, source);
      return true;
    } catch (error) {
      this.warnOnce(`addSource:${sourceId}`, `[OrbitalSurveyor] Failed to add source ${sourceId}`, error);
      return false;
    }
  }

  private addLayer(layer: Record<string, unknown>, beforeId?: string): void {
    if (!this.map) return;
    const layerId = typeof layer.id === 'string' ? layer.id : 'unknown';
    try {
      this.map.addLayer(layer, beforeId);
    } catch (error) {
      this.warnOnce(`addLayer:${layerId}`, `[OrbitalSurveyor] Failed to add layer ${layerId}`, error);
    }
  }

  private removeLayerOnly(layerId: string): void {
    if (!this.map) return;
    try {
      this.map.removeLayer(layerId);
    } catch (error) {
      this.warnOnce(`removeLayer:${layerId}`, `[OrbitalSurveyor] Failed to remove layer ${layerId}`, error);
    }
  }

  private setLayoutProperty(layerId: string, name: string, value: unknown): void {
    if (!this.map) return;
    try {
      this.map.setLayoutProperty(layerId, name, value);
    } catch (error) {
      this.warnOnce(`setLayoutProperty:${layerId}:${name}`, `[OrbitalSurveyor] Failed to set layout property ${name} on ${layerId}`, error);
    }
  }

  private setPaintProperty(layerId: string, name: string, value: unknown): void {
    if (!this.map) return;
    try {
      this.map.setPaintProperty(layerId, name, value);
    } catch (error) {
      this.warnOnce(`setPaintProperty:${layerId}:${name}`, `[OrbitalSurveyor] Failed to set paint property ${name} on ${layerId}`, error);
    }
  }

  private moveLayer(layerId: string, beforeId?: string): void {
    if (!this.map) return;
    try {
      this.map.moveLayer(layerId, beforeId);
    } catch (error) {
      this.warnOnce(`moveLayer:${layerId}`, `[OrbitalSurveyor] Failed to move raster layer ${layerId}`, error);
    }
  }

  private setTerrain(terrain: { source: string; exaggeration?: number } | null): void {
    if (!this.map?.setTerrain) return;
    try {
      this.map.setTerrain(terrain);
    } catch (error) {
      this.warnOnce('setTerrain', '[OrbitalSurveyor] Failed to update terrain', error);
      if (terrain) {
        this.scheduleEnsureLayers();
      }
    }
  }

  private warnOnce(key: string, message: string, error: unknown): void {
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    console.warn(message, error);
  }

  private resolveTerrainSourceProfile(providerId: string): TerrainSourceProfile {
    if (providerId === 'mapterhorn') {
      return {
        encoding: 'terrarium',
        tileSize: 512,
        maxzoom: 17,
        attribution: 'Terrain © Mapterhorn contributors',
      };
    }

    return {
      encoding: 'mapbox',
      tileSize: 256,
      maxzoom: 14,
      attribution: 'Terrain © MapTiler © OpenStreetMap contributors',
    };
  }
}
