/**
 * Example Panel Component
 * Demonstrates how to create React components for Subway Builder mods.
 *
 * Note: Floating panels provide their own container, so don't wrap in Card.
 */

import { useState } from 'react';

const api = window.SubwayBuilderAPI;

// Cast components to any to bypass strict typing (components work at runtime)
const { Button } = api.utils.components as Record<string, React.ComponentType<any>>;

export function ExamplePanel() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm text-muted-foreground">
        Click count: {count}
      </p>
      <Button onClick={() => setCount(c => c + 1)}>
        Increment
      </Button>
      <Button
        variant="secondary"
        onClick={() => api.ui.showNotification('Hello!', 'info')}
      >
        Show Notification
      </Button>
    </div>
  );
}
