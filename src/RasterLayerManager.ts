import { CITY_LAYER_GROUPS, MOD_ID, type SurveyorSettings } from './config';

type MapLike = {
  on: (type: string, listener: (event?: unknown) => void) => void;
  off: (type: string, listener: (event?: unknown) => void) => void;
  getSource: (id: string) => unknown;
  addSource: (id: string, source: Record<string, unknown>) => void;
  removeSource: (id: string) => void;
  getLayer: (id: string) => unknown;
  addLayer: (layer: Record<string, unknown>, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  setLayoutProperty: (layerId: string, name: string, value: unknown) => void;
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
  moveLayer: (layerId: string, beforeId?: string) => void;
  getStyle: () => {
    layers?: Array<{ id: string; source?: string; layout?: { visibility?: unknown } }>;
    sources?: Record<string, unknown>;
  };
  isStyleLoaded?: () => boolean | void;
  setStyle?: (style: unknown, options?: unknown) => unknown;
  setTerrain?: (terrain: { source: string; exaggeration?: number } | null) => void;
  getTerrain?: () => { source: string; exaggeration?: number } | null;
  getCanvas?: () => { style: { cursor: string } };
  getContainer?: () => HTMLElement;
};

const SATELLITE_SOURCE_ID = `${MOD_ID}:satellite-source`;
const SATELLITE_LAYER_ID = `${MOD_ID}:satellite-layer`;
const STREET_VIEW_SOURCE_ID = `${MOD_ID}:street-view-source`;
const STREET_VIEW_LAYER_ID = `${MOD_ID}:street-view-layer`;
const TERRAIN_DEM_SOURCE_ID = `${MOD_ID}:terrain-dem-source`;
const GAME_BASE_SOURCE_IDS = ['general-tiles'];
const GAME_CONTROLLED_LABEL_LAYERS = new Set(['ocean-depth-labels']);
const CITY_LAYER_ANCHORS = CITY_LAYER_GROUPS.flatMap((group) => group.layers);

const FALLBACK_ORDER_ANCHORS = [
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
const ROAD_LAYER_ANCHORS = ['road-labels', 'intersections-layer', 'road-lines'];
const STREET_VIEW_UPPER_ANCHORS = [
  'track-elevations',
  'tracks',
  'blueprint-tracks',
  'stations',
  'station-labels',
  'routes',
  'trains',
  'demand-points',
];

type LayerDefinition = {
  sourceId: string;
  layerId: string;
  providerId: string;
  layerName: 'satellite' | 'terrain' | 'streetview';
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
  private errorHandler: ((event?: unknown) => void) | null = null;
  private lastSourceKeys = new Map<string, string>();
  private ensureTimer: number | null = null;
  private proxyFailureTimer: number | null = null;
  private proxyFailureHandler: (() => void) | null = null;
  private patchedMap: MapLike | null = null;
  private originalSetStyle: MapLike['setStyle'] | null = null;
  private warnedKeys = new Set<string>();
  private filteredGameLayers = new Set<string>();
  private streetViewClickHandler: ((event?: unknown) => void) | null = null;
  private previousCanvasCursor: string | null = null;
  private attributionElement: HTMLElement | null = null;
  private attributionContainer: HTMLElement | null = null;
  private previousAttributionContainerPosition: string | null = null;

  setMap(map: MapLike): void {
    if (this.map === map) return;
    this.detachHandlers();
    this.map = map;
    this.patchSetStyle();
    this.attachHandlers();
    this.ensureAttributionElement();
    this.updateStreetViewClickHandler();
    this.ensureLayers();
  }

  setSettings(settings: SurveyorSettings): void {
    this.settings = { ...settings };
    this.updateAttributionElement();
    this.updateStreetViewClickHandler();
    this.ensureLayers();
  }

  setProxyFailureHandler(handler: (() => void) | null): void {
    this.proxyFailureHandler = handler;
  }

  reset(): void {
    this.clearScheduledEnsure();
    this.removeStreetViewClickHandler();
    this.restoreCityLayerVisibility();
    this.disableTerrain();
    this.removeSource(TERRAIN_DEM_SOURCE_ID);
    this.removeLayer(STREET_VIEW_LAYER_ID, STREET_VIEW_SOURCE_ID);
    this.removeLayer(SATELLITE_LAYER_ID, SATELLITE_SOURCE_ID);
    this.lastSourceKeys.clear();
    this.updateAttributionElement();
  }

  destroy(): void {
    this.detachHandlers();
    this.reset();
    this.removeAttributionElement();
    this.restoreSetStyle();
    this.map = null;
  }

  private attachHandlers(): void {
    if (!this.map) return;
    this.styleHandler = () => this.onStyleData();
    this.styleLoadingHandler = () => this.onStyleLoading();
    this.dataHandler = () => {
      this.applyCityLayerVisibility();
      this.reorderLayers();
    };
    this.errorHandler = (event?: unknown) => this.onMapError(event);
    this.map.on('styledata', this.styleHandler);
    this.map.on('styledataloading', this.styleLoadingHandler);
    this.map.on('data', this.dataHandler);
    this.map.on('error', this.errorHandler);
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
    if (this.errorHandler) {
      this.map.off('error', this.errorHandler);
      this.errorHandler = null;
    }
    this.removeStreetViewClickHandler();
    this.removeAttributionElement();
    this.clearScheduledEnsure();
    this.clearScheduledProxyFailure();
    this.restoreSetStyle();
  }

  private ensureLayers(): void {
    if (!this.map || !this.settings) return;
    this.removeInactiveProxyLayers();
    if (!this.isStyleReady()) {
      this.scheduleEnsureLayers();
      return;
    }

    this.ensureRasterLayer({
      sourceId: SATELLITE_SOURCE_ID,
      layerId: SATELLITE_LAYER_ID,
      providerId: this.settings.satelliteProvider,
      layerName: 'satellite',
      opacity: 1,
      visible: this.settings.satelliteEnabled,
      attribution: this.resolveRasterAttribution(this.settings.satelliteProvider),
    });

    this.ensureRasterLayer({
      sourceId: STREET_VIEW_SOURCE_ID,
      layerId: STREET_VIEW_LAYER_ID,
      providerId: 'streetview',
      layerName: 'streetview',
      opacity: 1,
      visible: this.settings.streetViewEnabled,
      attribution: this.resolveRasterAttribution('streetview'),
    });

    this.ensureTerrain({
      sourceId: TERRAIN_DEM_SOURCE_ID,
      providerId: this.settings.terrainProvider,
      exaggeration: this.settings.terrainExaggeration,
      enabled: this.settings.terrainEnabled,
    });

    this.applyCityLayerVisibility();
    this.updateAttributionElement();
    this.reorderLayers();
  }

  private removeInactiveProxyLayers(): void {
    if (!this.settings) return;
    if (!this.settings.satelliteEnabled) {
      this.removeLayer(SATELLITE_LAYER_ID, SATELLITE_SOURCE_ID);
      this.lastSourceKeys.delete(SATELLITE_SOURCE_ID);
    }
    if (!this.settings.streetViewEnabled) {
      this.removeLayer(STREET_VIEW_LAYER_ID, STREET_VIEW_SOURCE_ID);
      this.lastSourceKeys.delete(STREET_VIEW_SOURCE_ID);
    }
    if (!this.settings.terrainEnabled) {
      this.disableTerrain();
      this.removeSource(TERRAIN_DEM_SOURCE_ID);
      this.lastSourceKeys.delete(TERRAIN_DEM_SOURCE_ID);
    }
  }

  private ensureRasterLayer(definition: LayerDefinition): void {
    if (!this.map || !this.settings) return;

    if (!definition.visible) {
      this.removeLayer(definition.layerId, definition.sourceId);
      this.lastSourceKeys.delete(definition.sourceId);
      return;
    }

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
      this.removeSource(definition.sourceId);
      this.lastSourceKeys.delete(definition.sourceId);
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

  private buildTileUrl(providerId: string, layerName: 'satellite' | 'terrain' | 'streetview'): string {
    const proxyBaseUrl = this.settings?.proxyBaseUrl ?? '';
    if (layerName === 'streetview') {
      return `${proxyBaseUrl}/tiles/streetview/availability/{z}/{x}/{y}`;
    }
    return `${proxyBaseUrl}/tiles/${encodeURIComponent(providerId)}/${layerName}/{z}/{x}/{y}`;
  }

  private reorderLayers(): void {
    if (!this.map) return;
    const beforeId = this.findBeforeLayerId();
    if (this.hasLayer(SATELLITE_LAYER_ID)) {
      this.moveLayer(SATELLITE_LAYER_ID, beforeId);
    }
    if (this.hasLayer(STREET_VIEW_LAYER_ID)) {
      this.moveLayer(STREET_VIEW_LAYER_ID, this.findBeforeStreetViewLayerId());
    }
  }

  private applyCityLayerVisibility(): void {
    if (!this.map || !this.settings) return;
    const overlayActive = this.settings.satelliteEnabled || this.settings.terrainEnabled;

    CITY_LAYER_GROUPS.forEach((group) => {
      group.layers.forEach((layerId) => {
        if (!overlayActive) return;
        this.filteredGameLayers.add(layerId);
        this.setGameLayerVisibility(
          layerId,
          this.settings?.cityLayers[layerId] === false ? 'none' : 'visible',
        );
      });
    });

    if (!overlayActive) {
      this.restoreCityLayerVisibility();
    }
  }

  private restoreCityLayerVisibility(): void {
    if (!this.map) return;
    [...this.filteredGameLayers].forEach((layerId) => {
      this.filteredGameLayers.delete(layerId);
      if (GAME_CONTROLLED_LABEL_LAYERS.has(layerId)) return;
      this.setGameLayerVisibility(layerId, 'visible');
    });
  }

  private findBeforeLayerId(): string | undefined {
    if (!this.map) return undefined;
    try {
      const layerIds = this.map.getStyle().layers?.map((layer) => layer.id) ?? [];
      const cityLayerAnchor = CITY_LAYER_ANCHORS
        .filter((layerId) => layerIds.includes(layerId))
        .sort((first, second) => layerIds.indexOf(first) - layerIds.indexOf(second))[0];
      return cityLayerAnchor ?? FALLBACK_ORDER_ANCHORS.find((layerId) => layerIds.includes(layerId));
    } catch (error) {
      this.warnOnce('getStyle', '[OrbitalSurveyor] Failed to inspect map style', error);
      return undefined;
    }
  }

  private findBeforeStreetViewLayerId(): string | undefined {
    if (!this.map) return undefined;
    try {
      const layerIds = this.map.getStyle().layers?.map((layer) => layer.id) ?? [];
      const roadLayerIndexes = ROAD_LAYER_ANCHORS
        .map((layerId) => layerIds.indexOf(layerId))
        .filter((index) => index >= 0);
      if (!roadLayerIndexes.length) return this.findBeforeLayerId();

      const topRoadLayerIndex = Math.max(...roadLayerIndexes);
      return STREET_VIEW_UPPER_ANCHORS
        .map((layerId) => ({ layerId, index: layerIds.indexOf(layerId) }))
        .filter(({ index }) => index > topRoadLayerIndex)
        .sort((first, second) => first.index - second.index)[0]?.layerId;
    } catch (error) {
      this.warnOnce('getStyle:streetView', '[OrbitalSurveyor] Failed to inspect map style for Street View ordering', error);
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

  private updateStreetViewClickHandler(): void {
    if (!this.map || !this.settings?.streetViewEnabled) {
      this.removeStreetViewClickHandler();
      return;
    }

    if (this.streetViewClickHandler) return;
    this.streetViewClickHandler = (event?: unknown) => this.openStreetView(event);
    this.map.on('click', this.streetViewClickHandler);
    this.setStreetViewCursor();
  }

  private removeStreetViewClickHandler(): void {
    if (this.map && this.streetViewClickHandler) {
      this.map.off('click', this.streetViewClickHandler);
    }
    this.streetViewClickHandler = null;
    this.restoreStreetViewCursor();
  }

  private openStreetView(event?: unknown): void {
    const streetViewEvent = event as {
      lngLat?: { lng?: unknown; lat?: unknown };
      originalEvent?: Event;
    } | undefined;
    const lat = typeof streetViewEvent?.lngLat?.lat === 'number'
      ? streetViewEvent.lngLat.lat
      : Number.NaN;
    const lng = typeof streetViewEvent?.lngLat?.lng === 'number'
      ? streetViewEvent.lngLat.lng
      : Number.NaN;

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90) {
      this.warnOnce(
        'streetView:invalidCoordinate',
        '[OrbitalSurveyor] Street View click did not include a valid coordinate',
        new Error(`Invalid coordinate: ${String(lat)}, ${String(lng)}`),
      );
      return;
    }

    const normalizedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
    const url = `https://www.google.com/maps?layer=c&cbll=${lat.toFixed(6)},${normalizedLng.toFixed(6)}`;
    streetViewEvent?.originalEvent?.preventDefault();
    streetViewEvent?.originalEvent?.stopPropagation();
    void this.openExternalUrl(url);
  }

  private async openExternalUrl(url: string): Promise<void> {
    if (!window.electron?.openExternalUrl) {
      this.warnOnce(
        'streetView:noExternalBridge',
        '[OrbitalSurveyor] No external URL bridge is available for Street View',
        new Error(url),
      );
      return;
    }

    try {
      await window.electron.openExternalUrl(url);
    } catch (error) {
      this.warnOnce('streetView:openExternalUrl', '[OrbitalSurveyor] Failed to open Street View externally', error);
    }
  }

  private setStreetViewCursor(): void {
    const canvas = this.map?.getCanvas?.();
    if (!canvas || this.previousCanvasCursor !== null) return;
    this.previousCanvasCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
  }

  private restoreStreetViewCursor(): void {
    const canvas = this.map?.getCanvas?.();
    if (!canvas || this.previousCanvasCursor === null) return;
    canvas.style.cursor = this.previousCanvasCursor;
    this.previousCanvasCursor = null;
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

  private onMapError(event?: unknown): void {
    if (!this.isProxyBackedMapError(event)) return;
    this.scheduleProxyFailure();
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

  private scheduleProxyFailure(): void {
    if (!this.proxyFailureHandler || this.proxyFailureTimer !== null) return;
    this.proxyFailureTimer = window.setTimeout(() => {
      this.proxyFailureTimer = null;
      this.proxyFailureHandler?.();
    }, 500);
  }

  private clearScheduledProxyFailure(): void {
    if (this.proxyFailureTimer === null) return;
    window.clearTimeout(this.proxyFailureTimer);
    this.proxyFailureTimer = null;
  }

  private isProxyBackedMapError(event?: unknown): boolean {
    if (!this.settings) return false;
    const candidate = event as {
      sourceId?: unknown;
      source?: { id?: unknown };
      error?: { message?: unknown; stack?: unknown };
      url?: unknown;
      tile?: { url?: unknown };
    } | undefined;

    const sourceId = typeof candidate?.sourceId === 'string'
      ? candidate.sourceId
      : typeof candidate?.source?.id === 'string'
        ? candidate.source.id
        : '';
    if (
      sourceId === SATELLITE_SOURCE_ID ||
      sourceId === STREET_VIEW_SOURCE_ID ||
      sourceId === TERRAIN_DEM_SOURCE_ID
    ) {
      return true;
    }

    const proxyTilePrefix = `${this.settings.proxyBaseUrl}/tiles/`;
    const details = [
      candidate?.url,
      candidate?.tile?.url,
      candidate?.error?.message,
      candidate?.error?.stack,
    ]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');

    return details.includes(proxyTilePrefix);
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

  private setGameLayerVisibility(layerId: string, visibility: 'visible' | 'none'): void {
    if (!this.map || !this.hasLayer(layerId)) return;
    if (this.getLayerVisibility(layerId) === visibility) return;
    try {
      this.map.setLayoutProperty(layerId, 'visibility', visibility);
    } catch {
      // Game styles vary by city; missing or transient layers can be ignored.
    }
  }

  private getLayerVisibility(layerId: string): 'visible' | 'none' | null {
    if (!this.map) return null;
    try {
      const layer = this.map.getStyle().layers?.find((candidate) => candidate.id === layerId);
      if (!layer) return null;
      return layer.layout?.visibility === 'none' ? 'none' : 'visible';
    } catch {
      return null;
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

  private resolveActiveAttributions(): string[] {
    if (!this.settings) return [];
    const attributions = new Set<string>();

    if (this.settings.satelliteEnabled) {
      attributions.add(this.resolveRasterAttribution(this.settings.satelliteProvider));
    }
    if (this.settings.streetViewEnabled) {
      attributions.add(this.resolveRasterAttribution('streetview'));
    }
    if (this.settings.terrainEnabled) {
      attributions.add(this.resolveTerrainSourceProfile(this.settings.terrainProvider).attribution);
    }

    return [...attributions];
  }

  private ensureAttributionElement(): void {
    if (this.attributionElement) return;
    const container = this.map?.getContainer?.();
    if (!container) return;

    if (window.getComputedStyle(container).position === 'static') {
      this.previousAttributionContainerPosition = container.style.position;
      container.style.position = 'relative';
    }

    const element = document.createElement('div');
    element.className = 'os-attribution';
    container.appendChild(element);
    this.attributionElement = element;
    this.attributionContainer = container;
    this.updateAttributionElement();
  }

  private updateAttributionElement(): void {
    this.ensureAttributionElement();
    if (!this.attributionElement) return;

    const attributions = this.resolveActiveAttributions();
    this.attributionElement.textContent = attributions.join(' | ');
    this.attributionElement.toggleAttribute('data-visible', attributions.length > 0);
  }

  private removeAttributionElement(): void {
    this.attributionElement?.remove();
    this.attributionElement = null;
    if (
      this.attributionContainer &&
      this.previousAttributionContainerPosition !== null
    ) {
      this.attributionContainer.style.position = this.previousAttributionContainerPosition;
    }
    this.attributionContainer = null;
    this.previousAttributionContainerPosition = null;
  }

  private resolveRasterAttribution(providerId: string): string {
    if (providerId === 'esri') return 'Tiles © Esri';
    if (providerId === 'osm') return '© OpenStreetMap contributors';
    if (providerId === 'maptiler') return 'Tiles © MapTiler © OpenStreetMap contributors';
    if (providerId === 'streetview') return 'Street View © Google';
    if (providerId === 'custom') return 'Custom tiles';
    return 'Tiles © Google';
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
