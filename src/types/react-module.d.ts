declare module 'react' {
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: unknown[]): T;
  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps?: unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useReducer<TState, TAction>(
    reducer: (state: TState, action: TAction) => TState,
    initial: TState,
  ): [TState, (action: TAction) => void];
  export function useContext<T>(context: T): unknown;
  export function createContext<T>(defaultValue: T): T;
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  export const Fragment: unknown;
}

declare module 'react/jsx-runtime' {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}
