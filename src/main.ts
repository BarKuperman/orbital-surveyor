import { MOD_ID, MOD_NAME, MOD_VERSION, TAG, type SurveyorSettings } from './config';
import { RasterLayerManager } from './RasterLayerManager';
import { SurveyorStore, type SurveyorSnapshot } from './state';
import { SurveyorPanel } from './ui/SurveyorPanel';
import { injectSurveyorStyles } from './ui/styles';

const api = window.SubwayBuilderAPI;
const React = api?.utils.React;
const RUNTIME_REGISTRATION_KEY = '__orbitalSurveyorRegistered';
const DUPLICATE_REGISTRATION_WINDOW_MS = 2000;
type ReadyMap = Parameters<RasterLayerManager['setMap']>[0];
type RuntimeRegistration = {
  registeredAt: number;
};
type RuntimeWindow = Window & typeof globalThis & {
  [RUNTIME_REGISTRATION_KEY]?: RuntimeRegistration | boolean;
};

class OrbitalSurveyorMod {
  private initialized = false;
  private mapLayers: RasterLayerManager | null = null;
  private store: SurveyorStore | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private proxyOutageNotified = false;

  async initialize(map: ReadyMap): Promise<void> {
    if (this.initialized) {
      this.onMapReady(map);
      return;
    }
    this.initialized = true;

    if (!api) {
      console.error(`${TAG} SubwayBuilderAPI not found`);
      return;
    }

    console.log(`${TAG} ${MOD_NAME} v${MOD_VERSION} | API v${api.version}`);
    injectSurveyorStyles();

    this.mapLayers = new RasterLayerManager();
    this.store = new SurveyorStore(api);
    await this.store.initialize();
    this.mapLayers.setProxyFailureHandler(() => {
      void this.store?.refreshProxyHealth();
    });
    this.unsubscribeStore = this.store.subscribe(() => {
      this.handleStoreSnapshot(this.store!.getSnapshot());
    });

    api.ui.addFloatingPanel({
      id: 'orbital-surveyor-panel',
      title: 'Orbital Surveyor',
      icon: 'Satellite',
      defaultWidth: 360,
      defaultHeight: 520,
      render: () => React.createElement(SurveyorPanel, {
        store: this.store!,
        onSettingsChange: (settings: SurveyorSettings) => this.applySettings(settings),
      }),
    });

    this.onMapReady(map);
    this.handleStoreSnapshot(this.store.getSnapshot());
    console.log(`${TAG} Initialized`);
  }

  private onMapReady(map: unknown): void {
    if (!map || !this.mapLayers || !this.store) return;

    this.mapLayers.setMap(map as ReadyMap);
    const snapshot = this.store.getSnapshot();
    this.mapLayers.setProviderCatalog(snapshot.providerCatalog);
    this.mapLayers.setSettings(snapshot.effectiveSettings);
  }

  onGameEnd(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.mapLayers?.setProxyFailureHandler(null);
    this.mapLayers?.destroy();
    this.store?.destroy();
    this.mapLayers = null;
    this.store = null;
    this.initialized = false;
    this.proxyOutageNotified = false;
  }

  private applySettings(settings: SurveyorSettings): void {
    this.mapLayers?.setSettings(settings);
  }

  private handleStoreSnapshot(snapshot: SurveyorSnapshot): void {
    this.mapLayers?.setProviderCatalog(snapshot.providerCatalog);
    this.applySettings(snapshot.effectiveSettings);
    this.notifyProxyOutageIfNeeded(snapshot);
  }

  private notifyProxyOutageIfNeeded(snapshot: SurveyorSnapshot): void {
    const proxyReady = !snapshot.proxyError &&
      Boolean(snapshot.proxyHealth?.ok && (snapshot.proxyHealth.ready ?? true));
    const overlaySuppressed =
      (snapshot.settings.satelliteEnabled && !snapshot.effectiveSettings.satelliteEnabled) ||
      (snapshot.settings.terrainEnabled && !snapshot.effectiveSettings.terrainEnabled) ||
      (snapshot.settings.streetViewEnabled && !snapshot.effectiveSettings.streetViewEnabled) ||
      (snapshot.settings.railwayEnabled && !snapshot.effectiveSettings.railwayEnabled);

    if (!overlaySuppressed || proxyReady) {
      this.proxyOutageNotified = false;
      return;
    }
    if (this.proxyOutageNotified) return;

    this.proxyOutageNotified = true;
    console.warn(`${TAG} Proxy is not responding. Overlay layers were disabled until the proxy is available.`);
    api?.ui.showNotification(
      'Orbital Surveyor proxy is not responding. Overlay layers were disabled until the proxy is available.',
      'warning',
    );
  }

}

const runtimeWindow = window as RuntimeWindow;

if (!api) {
  console.error(`${TAG} SubwayBuilderAPI not found`);
} else if (hasRecentRuntimeRegistration(runtimeWindow)) {
  console.warn(`${TAG} Another Orbital Surveyor runtime is already registered; skipping duplicate registration.`);
} else {
  runtimeWindow[RUNTIME_REGISTRATION_KEY] = { registeredAt: Date.now() };
  const mod = new OrbitalSurveyorMod();
  api.hooks.onMapReady((map) => {
    void mod.initialize(map).catch((error) => {
      console.error(`${TAG} Failed to initialize`, error);
      api.ui.showNotification(`${MOD_ID} failed to load. Check console for details.`, 'error');
    });
  });
  api.hooks.onGameEnd(() => mod.onGameEnd());
}

function hasRecentRuntimeRegistration(runtime: RuntimeWindow): boolean {
  const registration = runtime[RUNTIME_REGISTRATION_KEY];
  if (!registration || typeof registration !== 'object') return false;
  return Date.now() - registration.registeredAt < DUPLICATE_REGISTRATION_WINDOW_MS;
}
