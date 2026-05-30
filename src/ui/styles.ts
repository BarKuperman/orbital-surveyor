export function injectSurveyorStyles(): void {
  const existing = document.getElementById('orbital-surveyor-stylesheet');
  const style = existing ?? document.createElement('style');
  style.id = 'orbital-surveyor-stylesheet';
  style.textContent = `
    .os-panel {
      box-sizing: border-box;
      height: 100%;
      max-height: min(100%, calc(100vh - 96px));
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .os-section {
      border: 1px solid hsl(var(--border));
      background: hsl(var(--background) / 0.45);
      border-radius: 8px;
      overflow: visible;
      flex: 0 0 auto;
    }

    .os-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      padding: 10px;
      background: hsl(var(--muted) / 0.24);
      transition: background-color 120ms ease;
    }

    .os-section-header:hover {
      background: hsl(var(--accent) / 0.42);
    }

    .os-section-body {
      padding: 10px;
      border-top: 1px solid hsl(var(--border) / 0.75);
      overflow: visible;
    }

    .os-layer-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
    }

    .os-layer-tile {
      min-height: 48px;
      border-radius: 8px;
      border: 1px solid hsl(var(--border));
      background: hsl(var(--muted) / 0.32);
      color: hsl(var(--muted-foreground));
      padding: 7px 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.1;
      text-align: center;
      cursor: pointer;
      transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
    }

    .os-layer-tile:hover {
      border-color: hsl(var(--primary) / 0.72);
      color: hsl(var(--foreground));
      background: hsl(var(--muted) / 0.48);
    }

    .os-layer-tile[data-enabled="true"] {
      border-color: hsl(var(--primary));
      background: hsl(var(--primary) / 0.18);
      color: hsl(var(--foreground));
      box-shadow: inset 0 0 0 1px hsl(var(--primary) / 0.18);
    }

    .os-small-action {
      min-height: 28px;
      height: 28px;
      padding: 0 8px;
      border-radius: 6px;
      font-size: 11px;
      line-height: 1;
    }

    .os-toggle {
      position: relative;
      width: 42px;
      height: 24px;
      flex: 0 0 auto;
      border-radius: 999px;
      border: 1px solid hsl(var(--border));
      background: hsl(var(--muted));
      transition: background-color 120ms ease, border-color 120ms ease;
    }

    .os-toggle[data-checked="true"] {
      border-color: hsl(var(--primary));
      background: hsl(var(--primary));
    }

    .os-toggle-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: hsl(var(--background));
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      transition: transform 120ms ease;
    }

    .os-toggle[data-checked="true"] .os-toggle-thumb {
      transform: translateX(18px);
    }

    .os-range {
      appearance: none;
      width: 100%;
      height: 6px;
      border-radius: 999px;
      cursor: pointer;
      background: hsl(var(--border));
    }

    .os-range::-webkit-slider-thumb {
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: hsl(var(--primary));
      border: 2px solid hsl(var(--background));
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    }

    .os-range::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: hsl(var(--primary));
      border: 2px solid hsl(var(--background));
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    }

    .os-select,
    .os-input {
      width: 100%;
      height: 32px;
      border: 1px solid hsl(var(--border));
      border-radius: 6px;
      background: hsl(var(--background));
      color: hsl(var(--foreground));
      padding: 0 8px;
      font-size: 12px;
    }
  `;
  if (!existing) document.head.appendChild(style);
}
