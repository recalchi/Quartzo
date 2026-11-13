// Substitui 'virtual:pwa-register' no build desktop (Electron não usa service worker).
export function registerSW(_opts?: unknown) {
  return () => Promise.resolve();
}
