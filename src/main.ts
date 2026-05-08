/**
 * My Subway Builder Mod
 * Entry point for the mod.
 */

import { ExamplePanel } from './ui/ExamplePanel';

const MOD_ID = 'com.author.modname';
const MOD_VERSION = '1.0.0';
const TAG = '[MyMod]';

const api = window.SubwayBuilderAPI;

if (!api) {
  console.error(`${TAG} SubwayBuilderAPI not found!`);
} else {
  console.log(`${TAG} v${MOD_VERSION} | API v${api.version}`);

  // Guard against double initialization (onMapReady can fire multiple times)
  let initialized = false;

  // Initialize mod when map is ready
  api.hooks.onMapReady((_map) => {
    if (initialized) return;
    initialized = true;

    try {
      // Example: Add a floating panel with a React component
      api.ui.addFloatingPanel({
        id: 'my-mod-panel',
        title: 'My Mod',
        icon: 'Puzzle',
        render: ExamplePanel,
      });

      // Example: Add a button to the escape menu
      api.ui.addButton('escape-menu', {
        id: 'my-mod-button',
        label: 'My Mod Button',
        onClick: () => {
          api.ui.showNotification('Hello from My Mod!', 'info');
        },
      });

      console.log(`${TAG} Initialized successfully.`);
    } catch (err) {
      console.error(`${TAG} Failed to initialize:`, err);
      api.ui.showNotification(`${MOD_ID} failed to load. Check console for details.`, 'error');
    }
  });
}
