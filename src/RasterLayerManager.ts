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
  getStyle: () => { layers?: Array<{ id: string }> };
  setTerrain?: (terrain: { source: string; exaggeration?: number } | null) => void;
};

const SATELLITE_SOURCE_ID = 'orbital-surveyor-satellite-source';
const SATELLITE_LAYER_ID = 'orbital-surveyor-satellite-layer';
const TERRAIN_DEM_SOURCE_ID = 'orbital-surveyor-terrain-dem-source';

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

export class RasterLayerManager {
  private map: MapLike | null = null;
  private settings: SurveyorSettings | null = null;
  private styleHandler: (() => void) | null = null;
  private dataHandler: (() => void) | null = null;
  private lastSourceKeys = new Map<string, string>();

  setMap(map: MapLike): void {
    if (this.map === map) return;
    this.detachHandlers();
    this.map = map;
    this.attachHandlers();
    this.ensureLayers();
  }

  setSettings(settings: SurveyorSettings): void {
    this.settings = { ...settings };
    this.ensureLayers();
  }

  reset(): void {
    this.disableTerrain();
    this.removeSource(TERRAIN_DEM_SOURCE_ID);
    this.removeLayer(SATELLITE_LAYER_ID, SATELLITE_SOURCE_ID);
    this.lastSourceKeys.clear();
  }

  destroy(): void {
    this.detachHandlers();
    this.reset();
    this.map = null;
  }

  private attachHandlers(): void {
    if (!this.map) return;
    this.styleHandler = () => this.ensureLayers();
    this.dataHandler = () => this.reorderLayers();
    this.map.on('styledata', this.styleHandler);
    this.map.on('data', this.dataHandler);
  }

  private detachHandlers(): void {
    if (!this.map) return;
    if (this.styleHandler) {
      this.map.off('styledata', this.styleHandler);
      this.styleHandler = null;
    }
    if (this.dataHandler) {
      this.map.off('data', this.dataHandler);
      this.dataHandler = null;
    }
  }

  private ensureLayers(): void {
    if (!this.map || !this.settings) return;

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

    if (!this.map.getSource(definition.sourceId)) {
      this.map.addSource(definition.sourceId, {
        type: 'raster',
        tiles: [this.buildTileUrl(definition.providerId, definition.layerName)],
        tileSize: 256,
        attribution: definition.attribution,
      });
    }

    if (!this.map.getLayer(definition.layerId)) {
      this.map.addLayer(
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
      this.map.setLayoutProperty(
        definition.layerId,
        'visibility',
        definition.visible ? 'visible' : 'none',
      );
      this.map.setPaintProperty(definition.layerId, 'raster-opacity', definition.opacity);
    }
  }

  private ensureTerrain(definition: TerrainDefinition): void {
    if (!this.map || !this.settings) return;

    const sourceKey = `${this.settings.proxyBaseUrl}|${definition.providerId}|terrain-rgb-v2`;
    if (this.lastSourceKeys.get(definition.sourceId) !== sourceKey) {
      this.disableTerrain();
      this.removeSource(definition.sourceId);
      this.lastSourceKeys.set(definition.sourceId, sourceKey);
    }

    if (!definition.enabled) {
      this.disableTerrain();
      return;
    }

    if (!this.map.getSource(definition.sourceId)) {
      this.map.addSource(definition.sourceId, {
        type: 'raster-dem',
        tiles: [this.buildTileUrl(definition.providerId, 'terrain')],
        tileSize: 256,
        maxzoom: 14,
        encoding: 'mapbox',
        attribution: 'Terrain © MapTiler © OpenStreetMap contributors',
      });
    }

    if (!this.map.setTerrain) {
      console.warn('[OrbitalSurveyor] MapLibre terrain API is not available on this map instance');
      return;
    }

    this.map.setTerrain({
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
      if (!this.map?.getLayer(layerId)) return;
      try {
        this.map.moveLayer(layerId, beforeId);
      } catch (error) {
        console.warn('[OrbitalSurveyor] Failed to move raster layer', layerId, error);
      }
    });
  }

  private findBeforeLayerId(): string | undefined {
    if (!this.map) return undefined;
    const layerIds = this.map.getStyle().layers?.map((layer) => layer.id) ?? [];
    return ORDER_ANCHORS.find((layerId) => layerIds.includes(layerId));
  }

  private removeLayer(layerId: string, sourceId: string): void {
    if (!this.map) return;
    if (this.map.getLayer(layerId)) {
      this.map.removeLayer(layerId);
    }
    if (this.map.getSource(sourceId)) {
      this.map.removeSource(sourceId);
    }
  }

  private disableTerrain(): void {
    if (!this.map?.setTerrain) return;
    this.map.setTerrain(null);
  }

  private removeSource(sourceId: string): void {
    if (!this.map) return;
    if (this.map.getSource(sourceId)) {
      this.map.removeSource(sourceId);
    }
  }
}
