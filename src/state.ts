import { DEFAULT_SETTINGS, mergeSettings, type SurveyorSettings } from './config';
import type { ModdingAPI } from './types/api';

export type ProxyHealth = {
  ok: boolean;
  status: string;
  providers: Record<string, { configured: boolean; layers: string[] }>;
};

export type SurveyorSnapshot = {
  settings: SurveyorSettings;
  proxyHealth: ProxyHealth | null;
  proxyError: string | null;
};

type Listener = () => void;

const STORAGE_KEY = 'settings';

export class SurveyorStore {
  private settings: SurveyorSettings = { ...DEFAULT_SETTINGS };
  private proxyHealth: ProxyHealth | null = null;
  private proxyError: string | null = null;
  private listeners = new Set<Listener>();
  private healthTimer: number | null = null;

  constructor(private readonly api: ModdingAPI) {}

  async initialize(): Promise<void> {
    const stored = await this.api.storage.get(STORAGE_KEY, DEFAULT_SETTINGS);
    this.settings = mergeSettings(stored);
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
      proxyHealth: this.proxyHealth,
      proxyError: this.proxyError,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async updateSettings(patch: Partial<SurveyorSettings>): Promise<SurveyorSettings> {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    this.emit();
    await this.api.storage.set(STORAGE_KEY, this.settings);
    if (patch.proxyBaseUrl !== undefined) {
      await this.refreshProxyHealth();
    }
    return { ...this.settings };
  }

  async refreshProxyHealth(): Promise<void> {
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
