import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PROXY_BASE_URL,
  PROVIDERS,
  normalizeProxyBaseUrl,
  type OverlayMode,
  type ProviderLayer,
  type SurveyorSettings,
} from '../config';
import type { SurveyorSnapshot, SurveyorStore } from '../state';

const api = window.SubwayBuilderAPI;
type Component = (props: Record<string, unknown>) => unknown;

const { Button, Input, Label, Slider } = api.utils.components as Record<string, Component>;

type Props = {
  store: SurveyorStore;
  onSettingsChange: (settings: SurveyorSettings) => void;
};

const MODES: Array<{ value: OverlayMode; label: string }> = [
  { value: 'base', label: 'Base' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'both', label: 'Both' },
];

export function SurveyorPanel({ store, onSettingsChange }: Props) {
  const [snapshot, setSnapshot] = useState<SurveyorSnapshot>(() => store.getSnapshot());
  const [proxyDraft, setProxyDraft] = useState(snapshot.settings.proxyBaseUrl);

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

  return (
    <div className="flex w-full flex-col gap-3 p-3 text-sm">
      <div className="flex flex-col gap-1">
        <Label>View mode</Label>
        <div className="grid grid-cols-4 gap-1">
          {MODES.map((mode) => (
            <Button
              key={mode.value}
              variant={snapshot.settings.mode === mode.value ? 'default' : 'secondary'}
              onClick={() => updateSettings({ mode: mode.value })}
            >
              {mode.label}
            </Button>
          ))}
        </div>
      </div>

      <ProviderSelect
        label="Satellite provider"
        value={snapshot.settings.satelliteProvider}
        options={satelliteProviders}
        onChange={(satelliteProvider) => updateSettings({ satelliteProvider })}
      />

      <OpacitySlider
        label="Satellite opacity"
        value={snapshot.settings.satelliteOpacity}
        onChange={(satelliteOpacity) => updateSettings({ satelliteOpacity })}
      />

      <ProviderSelect
        label="Terrain provider"
        value={snapshot.settings.terrainProvider}
        options={terrainProviders}
        onChange={(terrainProvider) => updateSettings({ terrainProvider })}
      />

      <OpacitySlider
        label="Terrain exaggeration"
        value={snapshot.settings.terrainExaggeration / 4}
        valueLabel={`${snapshot.settings.terrainExaggeration.toFixed(1)}x`}
        onChange={(value) => updateSettings({ terrainExaggeration: value * 4 })}
      />

      <div className="flex flex-col gap-1">
        <Label>Proxy URL</Label>
        <div className="flex gap-2">
          <Input
            value={proxyDraft}
            onChange={(event: { target: { value: string } }) => setProxyDraft(event.target.value)}
            placeholder={DEFAULT_PROXY_BASE_URL}
          />
          <Button onClick={() => updateSettings({ proxyBaseUrl: normalizeProxyBaseUrl(proxyDraft) })}>
            Apply
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded border border-border px-2 py-1.5">
        <span className="text-muted-foreground">Proxy</span>
        <span className={proxyStatus.ok ? 'text-green-500' : 'text-amber-500'}>
          {proxyStatus.label}
        </span>
      </div>

      <Button variant="secondary" onClick={() => void store.refreshProxyHealth()}>
        Refresh status
      </Button>
    </div>
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
        className="h-9 rounded border border-input bg-background px-2 text-sm"
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

function OpacitySlider({
  label,
  value,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  valueLabel?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <Label>{label}</Label>
        <span className="text-muted-foreground">{valueLabel ?? `${Math.round(value * 100)}%`}</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={5}
        value={[Math.round(value * 100)]}
        onValueChange={(values: number[]) => onChange((values[0] ?? 0) / 100)}
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
