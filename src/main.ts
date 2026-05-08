import { MOD_ID, MOD_NAME, MOD_VERSION, TAG, type SurveyorSettings } from './config';
import { RasterLayerManager } from './RasterLayerManager';
import { SurveyorStore } from './state';
import { SurveyorPanel } from './ui/SurveyorPanel';

const api = window.SubwayBuilderAPI;
const React = api?.utils.React;

class OrbitalSurveyorMod {
  private initialized = false;
  private mapLayers: RasterLayerManager | null = null;
  private store: SurveyorStore | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!api) {
      console.error(`${TAG} SubwayBuilderAPI not found`);
      return;
    }

    console.log(`${TAG} ${MOD_NAME} v${MOD_VERSION} | API v${api.version}`);

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

    api.ui.addToolbarButton({
      id: 'orbital-surveyor-cycle',
      icon: 'Layers',
      tooltip: 'Cycle map imagery',
      onClick: () => {
        void this.cycleMode();
      },
      isActive: () => this.store?.getSnapshot().settings.mode !== 'base',
    });

    api.hooks.onMapReady((map) => this.onMapReady(map));
    api.hooks.onGameEnd(() => this.onGameEnd());

    const currentMap = api.utils.getMap();
    if (currentMap) {
      this.onMapReady(currentMap);
    }

    this.applySettings(this.store.getSnapshot().settings);
    console.log(`${TAG} Initialized`);
  }

  private onMapReady(map: unknown): void {
    const resolvedMap = map ?? api.utils.getMap();
    if (!resolvedMap || !this.mapLayers || !this.store) return;

    this.mapLayers.setMap(resolvedMap as Parameters<RasterLayerManager['setMap']>[0]);
    this.mapLayers.setSettings(this.store.getSnapshot().settings);
  }

  private onGameEnd(): void {
    this.mapLayers?.reset();
  }

  private applySettings(settings: SurveyorSettings): void {
    this.mapLayers?.setSettings(settings);
  }

  private async cycleMode(): Promise<void> {
    if (!this.store) return;
    const current = this.store.getSnapshot().settings.mode;
    const next = current === 'base'
      ? 'satellite'
      : current === 'satellite'
        ? 'terrain'
        : current === 'terrain'
          ? 'both'
          : 'base';
    const settings = await this.store.updateSettings({ mode: next });
    this.applySettings(settings);
  }
}

void new OrbitalSurveyorMod().initialize().catch((error) => {
  console.error(`${TAG} Failed to initialize`, error);
  api?.ui.showNotification(`${MOD_ID} failed to load. Check console for details.`, 'error');
});
