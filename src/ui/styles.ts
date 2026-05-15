export function injectSurveyorStyles(): void {
  const existing = document.getElementById('orbital-surveyor-stylesheet');
  const style = existing ?? document.createElement('style');
  style.id = 'orbital-surveyor-stylesheet';
  style.textContent = `
	    .os-panel {
	      max-height: calc(100vh - 96px);
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
	      grid-template-columns: repeat(2, minmax(0, 1fr));
	      gap: 8px;
	    }

	    .os-layer-pill {
	      min-height: 34px;
	      border-radius: 8px;
	      border: 1px solid hsl(var(--border));
	      background: hsl(var(--muted) / 0.28);
	      color: hsl(var(--muted-foreground));
	      padding: 6px 8px;
	      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	      font-size: 11px;
	      line-height: 1.15;
	      text-align: left;
	      overflow-wrap: anywhere;
	      transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	    }

	    .os-layer-pill:hover {
	      border-color: hsl(var(--foreground) / 0.45);
	      color: hsl(var(--foreground));
	    }

	    .os-layer-pill[data-enabled="true"] {
	      border-color: hsl(var(--foreground));
	      background: hsl(var(--foreground));
	      color: hsl(var(--background));
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
