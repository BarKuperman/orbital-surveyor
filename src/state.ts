import { DEFAULT_SETTINGS, MOD_ID, mergeSettings, type SurveyorSettings } from './config';
import type { ModdingAPI } from './types/api';

export type ProxyHealth = {
  ok: boolean;
  ready?: boolean;
  status: string;
  timestamp?: string;
  uptimeSeconds?: number;
  providers: Record<string, { configured: boolean; layers: string[]; status?: string }>;
};

export type SurveyorSnapshot = {
  settings: SurveyorSettings;
  effectiveSettings: SurveyorSettings;
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

export class SurveyorStore {
  private settings: SurveyorSettings = { ...DEFAULT_SETTINGS };
  private proxyHealth: ProxyHealth | null = null;
  private proxyError: string | null = null;
  private listeners = new Set<Listener>();
  private healthTimer: number | null = null;
  private healthPromise: Promise<void> | null = null;

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
    this.listeners.clear();
  }

  getSnapshot(): SurveyorSnapshot {
    return {
      settings: { ...this.settings },
      effectiveSettings: this.getEffectiveSettings(),
      proxyHealth: this.proxyHealth,
      proxyError: this.proxyError,
    };
  }

  getEffectiveSettings(): SurveyorSettings {
    return applyOverlayAvailability(this.settings, this.proxyHealth, this.proxyError);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async updateSettings(patch: Partial<SurveyorSettings>): Promise<SurveyorSettings> {
    this.settings = mergeSettings({ ...this.settings, ...patch });
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
      this.proxyHealth = payload;
      this.proxyError = response.ok ? null : `Proxy returned ${response.status}`;
    } catch (error) {
      this.proxyHealth = null;
      this.proxyError = error instanceof Error ? error.message : 'Proxy unavailable';
    } finally {
      window.clearTimeout(timeoutId);
      this.emit();
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function applyOverlayAvailability(
  settings: SurveyorSettings,
  proxyHealth: ProxyHealth | null,
  proxyError: string | null,
): SurveyorSettings {
  const availability = resolveOverlayAvailability(proxyHealth, proxyError);
  return {
    ...settings,
    satelliteEnabled: settings.satelliteEnabled && availability.proxyReady,
    terrainEnabled: settings.terrainEnabled && availability.proxyReady,
    streetViewEnabled: settings.streetViewEnabled && availability.proxyReady,
  };
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
