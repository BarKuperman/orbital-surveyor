import { useEffect, useMemo, useState } from 'react';
import {
  CITY_LAYER_GROUPS,
  DEFAULT_CITY_LAYERS,
  DEFAULT_PROXY_BASE_URL,
  PROVIDERS,
  normalizeProxyBaseUrl,
  type ProviderLayer,
  type SurveyorSettings,
} from '../config';
import type { SurveyorSnapshot, SurveyorStore } from '../state';

const api = window.SubwayBuilderAPI;
type Component = (props: Record<string, unknown>) => unknown;

const { Button, Input, Label } = api.utils.components as Record<string, Component>;
const icons = api.utils.icons as Record<string, Component>;
const ChevronDown = icons.ChevronDown;
const SatelliteIcon = icons.Satellite;
const TerrainIcon = icons.Mountain;
const LayersIcon = icons.Layers;
const layerIcons = {
  buildings: icons.Building,
  water: icons.Droplets,
  parks: icons.TreePine,
  general: icons.Map,
  roads: icons.Route,
  airports: icons.Plane,
  areaLabels: icons.Type,
} as const;

type Props = {
  store: SurveyorStore;
  onSettingsChange: (settings: SurveyorSettings) => void;
};

export function SurveyorPanel({ store, onSettingsChange }: Props) {
  const [snapshot, setSnapshot] = useState<SurveyorSnapshot>(() => store.getSnapshot());
  const [proxyDraft, setProxyDraft] = useState(snapshot.settings.proxyBaseUrl);
  const [satelliteOpen, setSatelliteOpen] = useState(snapshot.settings.satelliteEnabled);
  const [terrainOpen, setTerrainOpen] = useState(snapshot.settings.terrainEnabled);
  const [layersOpen, setLayersOpen] = useState(false);

  useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store]);

  useEffect(() => {
    setProxyDraft(snapshot.settings.proxyBaseUrl);
  }, [snapshot.settings.proxyBaseUrl]);

  const satelliteProviders = useMemo(() => filterProviders('satellite'), []);
  const terrainProviders = useMemo(() => filterProviders('terrain'), []);
  const proxyStatus = formatProxyStatus(snapshot);

  const updateSettings = (patch: Partial<SurveyorSettings>) => {
    void store.updateSettings(patch).then(onSettingsChange);
  };

  const updateCityLayerGroup = (
    group: (typeof CITY_LAYER_GROUPS)[number],
    visible: boolean,
  ) => {
    const cityLayers = { ...snapshot.settings.cityLayers };
    for (const layerId of group.layers) {
      cityLayers[layerId] = visible;
    }
    updateSettings({
      cityLayers,
    });
  };

  const resetCityLayers = () => {
    updateSettings({ cityLayers: { ...DEFAULT_CITY_LAYERS } });
  };

  const selectAllCityLayers = () => {
    const cityLayers = { ...snapshot.settings.cityLayers };
    for (const group of CITY_LAYER_GROUPS) {
      for (const layerId of group.layers) {
        cityLayers[layerId] = true;
      }
    }
    updateSettings({ cityLayers });
  };

  const hasVisibleCityLayer = CITY_LAYER_GROUPS.some((group) => (
    group.layers.some((layerId) => snapshot.settings.cityLayers[layerId])
  ));
  const allCityLayersVisible = CITY_LAYER_GROUPS.every((group) => (
    group.layers.every((layerId) => snapshot.settings.cityLayers[layerId])
  ));

  return (
    <div
      className="os-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        width: '100%',
        minHeight: 0,
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto',
      }}
    >
      <OverlaySection
        title="Satellite"
        description={snapshot.settings.satelliteEnabled ? 'Imagery visible' : 'Imagery hidden'}
        icon={SatelliteIcon}
        enabled={snapshot.settings.satelliteEnabled}
        open={satelliteOpen}
        onOpenChange={setSatelliteOpen}
        onEnabledChange={(satelliteEnabled) => updateSettings({ satelliteEnabled })}
      >
        <ProviderSelect
          label="Provider"
          value={snapshot.settings.satelliteProvider}
          options={satelliteProviders}
          onChange={(satelliteProvider) => updateSettings({ satelliteProvider })}
        />
      </OverlaySection>

      <OverlaySection
        title="Terrain"
        description={snapshot.settings.terrainEnabled ? '3D terrain enabled' : '3D terrain disabled'}
        icon={TerrainIcon}
        enabled={snapshot.settings.terrainEnabled}
        open={terrainOpen}
        onOpenChange={setTerrainOpen}
        onEnabledChange={(terrainEnabled) => updateSettings({ terrainEnabled })}
      >
        <ProviderSelect
          label="Provider"
          value={snapshot.settings.terrainProvider}
          options={terrainProviders}
          onChange={(terrainProvider) => updateSettings({ terrainProvider })}
        />
        <RangeControl
          label="Exaggeration"
          value={snapshot.settings.terrainExaggeration}
          min={0}
          max={4}
          step={0.1}
          formatValue={(value) => `${value.toFixed(1)}x`}
          onChange={(terrainExaggeration) => updateSettings({ terrainExaggeration })}
        />
      </OverlaySection>

      <PanelSection
        title="Layer filtering"
        description={hasVisibleCityLayer ? 'Custom layer mix' : 'Default overlay view'}
        icon={LayersIcon}
        open={layersOpen}
        onOpenChange={setLayersOpen}
        action={(
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              className="os-small-action"
              disabled={allCityLayersVisible}
              onClick={selectAllCityLayers}
            >
              Select all
            </Button>
            {hasVisibleCityLayer ? (
              <Button variant="secondary" className="os-small-action" onClick={resetCityLayers}>
                Reset
              </Button>
            ) : null}
          </div>
        )}
      >
        <div className="os-layer-grid">
          {CITY_LAYER_GROUPS.map((group) => {
            const enabled = group.layers.some((layerId) => snapshot.settings.cityLayers[layerId]);
            return (
              <LayerTile
                key={group.key}
                label={group.label}
                icon={layerIcons[group.key] ?? icons.Circle}
                enabled={enabled}
                onClick={() => updateCityLayerGroup(group, !enabled)}
              />
            );
          })}
        </div>
      </PanelSection>

      <div className="os-section p-2">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Proxy</span>
          <span className={proxyStatus.ok ? 'text-green-500' : 'text-amber-500'}>
            {proxyStatus.label}
          </span>
        </div>
        <div className="flex gap-2">
          <Input
            className="os-input"
            value={proxyDraft}
            onChange={(event: { target: { value: string } }) => setProxyDraft(event.target.value)}
            placeholder={DEFAULT_PROXY_BASE_URL}
          />
          <Button onClick={() => updateSettings({ proxyBaseUrl: normalizeProxyBaseUrl(proxyDraft) })}>
            Apply
          </Button>
        </div>
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => void store.refreshProxyHealth()}
        >
          Refresh status
        </button>
      </div>
    </div>
  );
}

function OverlaySection({
  title,
  description,
  icon,
  enabled,
  open,
  children,
  onOpenChange,
  onEnabledChange,
}: {
  title: string;
  description: string;
  icon?: Component;
  enabled: boolean;
  open: boolean;
  children: unknown;
  onOpenChange: (open: boolean) => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <PanelSection
      title={title}
      description={description}
      icon={icon}
      open={open}
      onOpenChange={onOpenChange}
      action={(
        <ToggleButton
          checked={enabled}
          onChange={onEnabledChange}
        />
      )}
    >
      <div className="flex flex-col gap-3">{children}</div>
    </PanelSection>
  );
}

function PanelSection({
  title,
  description,
  icon: Icon,
  open,
  action,
  children,
  onOpenChange,
}: {
  title: string;
  description: string;
  icon?: Component;
  open: boolean;
  action?: unknown;
  children: unknown;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <section className="os-section">
      <div className="os-section-header">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onOpenChange(!open)}
        >
          {Icon ? <Icon size={15} className="shrink-0 text-muted-foreground" /> : null}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">{description}</span>
          </span>
          {ChevronDown ? (
            <ChevronDown
              size={15}
              className={[
                'shrink-0 text-muted-foreground transition-transform',
                open ? 'rotate-180' : '',
              ].join(' ')}
            />
          ) : (
            <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
          )}
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {open ? <div className="os-section-body">{children}</div> : null}
    </section>
  );
}

function ToggleButton({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="os-toggle"
      data-checked={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
    >
      <span className="os-toggle-thumb" />
    </button>
  );
}

function LayerTile({
  label,
  icon: Icon,
  enabled,
  onClick,
}: {
  label: string;
  icon?: Component;
  enabled: boolean;
  onClick: () => void;
  key?: string;
}) {
  return (
    <button
      type="button"
      className="os-layer-tile"
      data-enabled={enabled ? 'true' : 'false'}
      style={{
        minHeight: 48,
        borderRadius: 8,
        border: enabled ? '1px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
        background: enabled ? 'hsl(var(--primary) / 0.18)' : 'hsl(var(--muted) / 0.32)',
        color: enabled ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
        padding: '7px 6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.1,
        textAlign: 'center',
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      {Icon ? <Icon size={16} className="shrink-0" /> : null}
      <span>{label}</span>
    </button>
  );
}

function ProviderSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <select
        className="os-select"
        value={value}
        onChange={(event: { target: { value: string } }) => onChange(event.target.value)}
      >
        {options.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{formatValue(value)}</span>
      </div>
      <input
        className="os-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{
          background: `linear-gradient(to right, hsl(var(--primary)) ${percentage}%, hsl(var(--border)) ${percentage}%)`,
        }}
        onChange={(event: { target: { value: string } }) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function filterProviders(layer: ProviderLayer): Array<{ id: string; label: string }> {
  return PROVIDERS
    .filter((provider) => provider.layers.includes(layer))
    .map((provider) => ({ id: provider.id, label: provider.label }));
}

function formatProxyStatus(snapshot: SurveyorSnapshot): { ok: boolean; label: string } {
  if (snapshot.proxyError) {
    return { ok: false, label: snapshot.proxyError };
  }
  if (!snapshot.proxyHealth) {
    return { ok: false, label: 'Checking' };
  }
  return {
    ok: snapshot.proxyHealth.ok,
    label: snapshot.proxyHealth.ok ? 'Ready' : snapshot.proxyHealth.status,
  };
}
