import { MOD_ID, MOD_NAME, MOD_VERSION, TAG, type SurveyorSettings } from './config';
import { RasterLayerManager } from './RasterLayerManager';
import { SurveyorStore } from './state';
import { SurveyorPanel } from './ui/SurveyorPanel';
import { injectSurveyorStyles } from './ui/styles';

const api = window.SubwayBuilderAPI;
const React = api?.utils.React;
type ReadyMap = Parameters<RasterLayerManager['setMap']>[0];

class OrbitalSurveyorMod {
  private initialized = false;
  private mapLayers: RasterLayerManager | null = null;
  private store: SurveyorStore | null = null;

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
    this.applySettings(this.store.getSnapshot().settings);
    console.log(`${TAG} Initialized`);
  }

  private onMapReady(map: unknown): void {
    if (!map || !this.mapLayers || !this.store) return;

    this.mapLayers.setMap(map as ReadyMap);
    this.mapLayers.setSettings(this.store.getSnapshot().settings);
  }

  onGameEnd(): void {
    this.mapLayers?.destroy();
    this.store?.destroy();
    this.mapLayers = null;
    this.store = null;
    this.initialized = false;
  }

  private applySettings(settings: SurveyorSettings): void {
    this.mapLayers?.setSettings(settings);
  }

}

if (!api) {
  console.error(`${TAG} SubwayBuilderAPI not found`);
} else {
  const mod = new OrbitalSurveyorMod();
  api.hooks.onMapReady((map) => {
    void mod.initialize(map).catch((error) => {
      console.error(`${TAG} Failed to initialize`, error);
      api.ui.showNotification(`${MOD_ID} failed to load. Check console for details.`, 'error');
    });
  });
  api.hooks.onGameEnd(() => mod.onGameEnd());
}
