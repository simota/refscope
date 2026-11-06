import { lazy, useState, type ComponentType } from "react";

/**
 * `React.lazy` with a `preload()` that fetches the chunk ahead of use.
 *
 * A component whose chunk has already loaded when it mounts renders
 * directly, so a preloaded view never flashes its Suspense fallback. The
 * choice is fixed per mount: a component that mounted through the lazy path
 * keeps that element type, so it is not remounted (losing state) when the
 * chunk finishes loading.
 */
export function lazyWithPreload<P extends object>(
  load: () => Promise<ComponentType<P>>,
) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        // Let a later attempt retry a failed chunk request.
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  // React's lazy() typings widen props to PropsWithRef<P>; the wrapper only
  // ever forwards P, so narrow it back to the component type it renders.
  const Lazy = lazy(() => preload().then((component) => ({ default: component }))) as unknown as ComponentType<P>;

  function LazyWithPreload(props: P) {
    const [Direct] = useState(() => loaded);
    return Direct ? <Direct {...props} /> : <Lazy {...props} />;
  }
  LazyWithPreload.preload = preload;
  return LazyWithPreload;
}

/**
 * `true` from the first render where `active` is true, and on every render
 * after it. Mounts an on-demand view (a dialog) the first time it is opened
 * and keeps it mounted afterwards, so its state and close animation behave
 * as if it had been mounted from the start.
 */
export function useLatch(active: boolean): boolean {
  const [latched, setLatched] = useState(active);
  // Setting state during render is React's sanctioned way to derive it from
  // props; it re-renders this component before the children see it.
  if (active && !latched) setLatched(true);
  return latched || active;
}

/** Run `task` once the browser is idle (or soon, where idle callbacks are missing). */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 1500);
  return () => window.clearTimeout(handle);
}
