# Orbital Surveyor

Orbital Surveyor adds satellite imagery, 3D terrain, and Street View availability overlays to Subway Builder's in-game MapLibre map.

Use it to inspect real-world map context while planning: compare the in-game city against satellite imagery, check terrain shape, view Street View coverage, and temporarily hide built-in map layers that get in the way.

## Features

- Satellite imagery overlays from supported tile providers.
- 3D terrain using MapLibre terrain data.
- Street View availability overlay.
- Click-to-open Google Street View in your external browser.
- Map layer filtering for buildings, water, parks, roads, airports, and area labels.

-----------------

## Requirements

- **[Node.js](https://nodejs.org/) installed on your system.**
- The Orbital Surveyor local proxy running while using satellite, terrain, or Street View overlays.

## Quick Start Guide

#### 1. Install The Mod:

Install Orbital Surveyor through Railyard, or place the mod folder in your Subway Builder mods folder manually.

#### 2. Start The Proxy:

Before opening or reloading the mod, start the proxy from the Orbital Surveyor mod folder:

- Windows: double-click `start-proxy-windows.cmd`.
- macOS: double-click `start-proxy-macos.command`.
- Linux: run `start-proxy-linux.sh`.

On Linux, if the launcher is not executable yet, run this once from the mod folder:

```bash
chmod +x start-proxy-linux.sh
```

You can also start the proxy manually:

```bash
node proxy.js
```

Leave the proxy window open while playing.

#### 3. Enable The Mod:

In Subway Builder, go to `Settings > Mods` and enable Orbital Surveyor.

#### 4. Use The Panel:

Open the Orbital Surveyor panel in-game and enable Satellite, Terrain, or Street View as needed.

## Notes

- Additional details in the [README](https://github.com/BarKuperman/orbital-surveyor#orbital-surveyor)

- Terrain mode is heavier than the normal map and may briefly reload when changing views or map layers. Tracks and stations may be less visible or temporarily hidden while Terrain is enabled, especially in 3D view.

- Third-party map tiles, imagery, terrain data, and Street View data remain subject to their respective provider licenses, attribution requirements, and usage policies.