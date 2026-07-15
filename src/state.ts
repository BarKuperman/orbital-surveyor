import { DEFAULT_SETTINGS, MOD_ID, mergeSettings, type SurveyorSettings } from './config';
import {
  BUILTIN_PROVIDER_CATALOG,
  formatProviderAvailabilityReason,
  isProviderLayerConfigured,
  mergeProviderCatalog,
  normalizeProviderIssues,
  type ProviderCatalog,
  type ProviderIssue,
  type SelectableProviderLayer,
} from './providers';
import type { ModdingAPI } from './types/api';

export type ProxyHealth = {
  ok: boolean;
  ready?: boolean;
  status: string;
  timestamp?: string;
  uptimeSeconds?: number;
  providers: ProviderCatalog;
  providerIssues?: ProviderIssue[];
};

export type SurveyorSnapshot = {
  settings: SurveyorSettings;
  effectiveSettings: SurveyorSettings;
  providerCatalog: ProviderCatalog;
  proxyHealth: ProxyHealth | null;
  proxyError: string | null;
};

export type OverlayAvailability = {
  proxyReady: boolean;
  proxyReason: string;
};

type Listener = () => void;

const STORAGE_KEY = 'settings';
const LOCAL_STORAGE_KEY = `${MOD_ID}:${STORAGE_KEY}`;
const HEALTH_CONFIRM_RETRY_MS = 1000;
const BUILTIN_PROVIDER_IDS = new Set(Object.keys(BUILTIN_PROVIDER_CATALOG));

export class SurveyorStore {
  private settings: SurveyorSettings = { ...DEFAULT_SETTINGS };
  private proxyHealth: ProxyHealth | null = null;
  private proxyError: string | null = null;
  private providerCatalog: ProviderCatalog = { ...BUILTIN_PROVIDER_CATALOG };
  private listeners = new Set<Listener>();
  private healthTimer: number | null = null;
  private healthRetryTimer: number | null = null;
  private healthPromise: Promise<void> | null = null;
  private healthFailureCount = 0;
  private customProviderLogSignature: string | null = null;

  constructor(private readonly api: ModdingAPI) {}

  async initialize(): Promise<void> {
    const stored = await this.loadSettings();
    this.settings = resetOverlayEnabledSettings(mergeSettings(stored));
    this.saveSettings(this.settings);
    this.emit();
    await this.refreshProxyHealth();
    this.healthTimer = window.setInterval(() => {
      void this.refreshProxyHealth();
    }, 15000);
  }

  destroy(): void {
    if (this.healthTimer !== null) {
      window.clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.clearHealthRetry();
    this.listeners.clear();
  }

  getSnapshot(): SurveyorSnapshot {
    return {
      settings: { ...this.settings },
      effectiveSettings: this.getEffectiveSettings(),
      providerCatalog: this.providerCatalog,
      proxyHealth: this.proxyHealth,
      proxyError: this.proxyError,
    };
  }

  getEffectiveSettings(): SurveyorSettings {
    return applyOverlayAvailability(this.settings, this.proxyHealth, this.proxyError, this.providerCatalog);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async updateSettings(patch: Partial<SurveyorSettings>): Promise<SurveyorSettings> {
    const previousProxyBaseUrl = this.settings.proxyBaseUrl;
    this.settings = mergeSettings({ ...this.settings, ...patch });
    if (patch.proxyBaseUrl !== undefined && this.settings.proxyBaseUrl !== previousProxyBaseUrl) {
      this.healthFailureCount = 0;
      this.proxyHealth = null;
      this.proxyError = null;
      this.providerCatalog = { ...BUILTIN_PROVIDER_CATALOG };
      this.clearHealthRetry();
    }
    this.emit();
    this.saveSettings(this.settings);
    if (patch.proxyBaseUrl !== undefined) {
      await this.refreshProxyHealth();
    }
    return { ...this.settings };
  }

  private async loadSettings(): Promise<unknown> {
    const stored = readLocalSettings();
    if (stored !== null) return stored;

    try {
      return await this.api.storage.get(STORAGE_KEY, DEFAULT_SETTINGS);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private saveSettings(settings: SurveyorSettings): void {
    writeLocalSettings(settings);
  }

  async refreshProxyHealth(): Promise<void> {
    if (this.healthPromise) return this.healthPromise;
    this.healthPromise = this.fetchProxyHealth().finally(() => {
      this.healthPromise = null;
    });
    return this.healthPromise;
  }

  private async fetchProxyHealth(): Promise<void> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);

    try {
      const response = await fetch(`${this.settings.proxyBaseUrl}/health`, {
        signal: controller.signal,
      });
      const payload = await response.json() as ProxyHealth;
      payload.providerIssues = normalizeProviderIssues(payload.providerIssues);
      this.healthFailureCount = 0;
      this.clearHealthRetry();
      this.proxyHealth = payload;
      this.providerCatalog = mergeProviderCatalog(payload.providers);
      this.logCustomProviderCatalog();
      this.proxyError = response.ok ? null : `Proxy returned ${response.status}`;
    } catch (error) {
      const wasReady = isProxyHealthReady(this.proxyHealth, this.proxyError);
      this.healthFailureCount += 1;
      if (wasReady && this.healthFailureCount === 1) {
        this.scheduleHealthRetry();
      } else {
        this.proxyHealth = null;
        this.proxyError = error instanceof Error ? error.message : 'Proxy unavailable';
        this.clearHealthRetry();
      }
    } finally {
      window.clearTimeout(timeoutId);
      this.emit();
    }
  }

  private scheduleHealthRetry(): void {
    if (this.healthRetryTimer !== null) return;
    this.healthRetryTimer = window.setTimeout(() => {
      this.healthRetryTimer = null;
      void this.refreshProxyHealth();
    }, HEALTH_CONFIRM_RETRY_MS);
  }

  private clearHealthRetry(): void {
    if (this.healthRetryTimer === null) return;
    window.clearTimeout(this.healthRetryTimer);
    this.healthRetryTimer = null;
  }

  private logCustomProviderCatalog(): void {
    const customProviders = Object.values(this.providerCatalog)
      .filter((provider) => !BUILTIN_PROVIDER_IDS.has(provider.id))
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        layers: Object.entries(provider.layers).map(([layer, metadata]) => ({
          layer,
          configured: metadata?.configured === true,
        })),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const signature = JSON.stringify(customProviders);
    if (signature === this.customProviderLogSignature) return;
    this.customProviderLogSignature = signature;

    if (customProviders.length === 0) {
      console.log('[OrbitalSurveyor] Proxy reported no custom providers.');
      return;
    }
    console.log(`[OrbitalSurveyor] Custom providers received from proxy: ${customProviders.map((provider) => provider.id).join(', ')}`);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function applyOverlayAvailability(
  settings: SurveyorSettings,
  proxyHealth: ProxyHealth | null,
  proxyError: string | null,
  providerCatalog: ProviderCatalog = BUILTIN_PROVIDER_CATALOG,
): SurveyorSettings {
  const availability = resolveOverlayAvailability(proxyHealth, proxyError);
  return {
    ...settings,
    satelliteEnabled: settings.satelliteEnabled && availability.proxyReady &&
      isProviderLayerConfigured(providerCatalog, settings.satelliteProvider, 'satellite'),
    terrainEnabled: settings.terrainEnabled && availability.proxyReady &&
      isProviderLayerConfigured(providerCatalog, settings.terrainProvider, 'terrain'),
    streetViewEnabled: settings.streetViewEnabled && availability.proxyReady &&
      isProviderLayerConfigured(providerCatalog, 'streetview', 'availability'),
  };
}

export function resolveSelectedProviderAvailability(
  snapshot: SurveyorSnapshot,
  layer: SelectableProviderLayer,
): { ready: boolean; reason: string } {
  const proxy = resolveOverlayAvailability(snapshot.proxyHealth, snapshot.proxyError);
  if (!proxy.proxyReady) return { ready: false, reason: proxy.proxyReason };
  const providerId = layer === 'satellite'
    ? snapshot.settings.satelliteProvider
    : snapshot.settings.terrainProvider;
  const provider = snapshot.providerCatalog[providerId];
  if (!provider) {
    const issue = snapshot.proxyHealth?.providerIssues?.find((candidate) => (
      candidate.id === providerId && candidate.layer === layer
    ));
    return {
      ready: false,
      reason: issue
        ? `${issue.label}: ${formatProviderAvailabilityReason(issue.reason)}`
        : `Provider "${providerId}" is unavailable`,
    };
  }
  const providerLayer = provider.layers[layer];
  if (!providerLayer) {
    return { ready: false, reason: `${provider.label}: ${formatProviderAvailabilityReason('unsupported_layer')}` };
  }
  if (!providerLayer.configured) {
    return {
      ready: false,
      reason: `${provider.label}: ${formatProviderAvailabilityReason(
        providerLayer.availabilityReason ?? 'invalid_configuration',
      )}`,
    };
  }
  return { ready: true, reason: 'Ready' };
}

export function resolveOverlayAvailability(
  proxyHealth: ProxyHealth | null,
  proxyError: string | null,
): OverlayAvailability {
  const proxyReason = resolveProxyReason(proxyHealth, proxyError);
  const proxyReady = !proxyError && Boolean(proxyHealth?.ok && (proxyHealth.ready ?? true));

  return {
    proxyReady,
    proxyReason,
  };
}

function resolveProxyReason(proxyHealth: ProxyHealth | null, proxyError: string | null): string {
  if (proxyError) return proxyError;
  if (!proxyHealth) return 'Checking proxy';
  return proxyHealth.ok && (proxyHealth.ready ?? true) ? 'Ready' : proxyHealth.status;
}

function isProxyHealthReady(proxyHealth: ProxyHealth | null, proxyError: string | null): boolean {
  return !proxyError && Boolean(proxyHealth?.ok && (proxyHealth.ready ?? true));
}

function readLocalSettings(): unknown | null {
  try {
    const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeLocalSettings(settings: SurveyorSettings): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings are non-critical; keep the in-memory state if storage is unavailable.
  }
}

function resetOverlayEnabledSettings(settings: SurveyorSettings): SurveyorSettings {
  return {
    ...settings,
    satelliteEnabled: false,
    terrainEnabled: false,
    streetViewEnabled: false,
  };
}
