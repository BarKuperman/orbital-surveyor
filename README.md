# Subway Builder Mod Template

> [!IMPORTANT]
> This template targets **Modding API v1.0.0**. Types may not match older or newer game versions.

TypeScript + React template for Subway Builder mods using rolldown-vite. **Please use pnpm!**

## Setup

```bash
pnpm install
```

## Scripts

| Command           | Description                           |
| ----------------- | ------------------------------------- |
| `pnpm build`      | Build the mod to `dist/`              |
| `pnpm dev`        | Watch mode + launch game with logging |
| `pnpm dev:link`   | Symlink `dist/` to game's mods folder |
| `pnpm dev:unlink` | Remove the symlink                    |
| `pnpm typecheck`  | Run TypeScript type checking          |

## Development Workflow

1. Build and link your mod:

   ```bash
   pnpm build
   pnpm dev:link
   ```

2. Enable the mod in Subway Builder: Settings > Mods

3. Start development with hot reload:

   ```bash
   pnpm dev
   ```

   This runs the vite watcher and game simultaneously. Logs are saved to `debug/latest.log`.

4. After making changes, reload mods in-game or restart. You can use CTRL + SHIFT + R or CMD + SHIFT + R to hot reload in-game.

## Project Structure

```
├── src/
│   ├── main.ts              # Entry point
│   ├── ui/
│   │   └── ExamplePanel.tsx # Example React component
│   └── types/
│       ├── react.ts         # React shim (pulls from game API)
│       ├── index.d.ts       # Re-exports + global Window
│       ├── api.d.ts         # Main ModdingAPI interface
│       ├── core.d.ts        # Coordinate, BoundingBox, etc.
│       ├── game-state.d.ts  # Station, Track, Train, Route
│       ├── build.d.ts       # Build automation
│       ├── ui.d.ts          # UI placements & options
│       └── ...              # + 13 more type modules
├── scripts/
│   ├── run.ts               # Game launcher with logging
│   └── link.ts              # Symlink management
├── manifest.json            # Mod metadata
├── vite.config.ts           # Build config
└── tsconfig.json
```

## Configuration

Edit `manifest.json` to set your mod's ID, name, and description:

```json
{
  "id": "com.yourname.yourmod",
  "name": "Your Mod Name",
  "description": "What it does",
  "version": "1.0.0",
  "author": { "name": "Your Name" },
  "main": "index.js"
}
```

## Using React

React is provided by the game at runtime. Import hooks normally:

```tsx
import { useState, useEffect } from "react";
```

For game UI components, pull them from the API:

```tsx
const { Button, Card } = window.SubwayBuilderAPI.utils.components as Record<
  string,
  React.ComponentType<any>
>;
```

## Game API

Access the full API via `window.SubwayBuilderAPI`:

```ts
const api = window.SubwayBuilderAPI;

// Hooks
api.hooks.onMapReady((map) => { ... });
api.hooks.onDayChange((day) => { ... });

// UI - Floating panels (icon names from Lucide)
api.ui.addFloatingPanel({
  id: 'my-panel',
  title: 'My Panel',
  icon: 'Settings',
  render: MyComponent,
});

// UI - Buttons and notifications
api.ui.addButton('escape-menu', { id: 'btn', label: 'Click', onClick: () => {} });
api.ui.showNotification('Hello', 'info');

// Game state
api.gameState.getStations();
api.gameState.getBudget();

// Actions
api.actions.setMoney(1000000);
api.actions.setPause(true);
```

See `src/types/` for the full API type reference, or the [official docs](https://www.subwaybuilder.com/docs/v1.0.0).

## Mods Folder Location

- **macOS**: `~/Library/Application Support/metro-maker4/mods/`
- **Windows**: `%APPDATA%\metro-maker4\mods\`
- **Linux**: `~/.config/metro-maker4/mods/`
