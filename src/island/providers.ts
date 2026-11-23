import { createProviderGroup } from 'zebar';

/** Every data source the island reads, created once per widget window. */
export const providers = createProviderGroup({
  clock: { type: 'date', formatting: 'ccc d LLL   HH:mm', locale: 'en', refreshInterval: 1000 },
  audio: { type: 'audio' },
  keyboard: { type: 'keyboard', refreshInterval: 1000 },
  media: { type: 'media' },
  cpu: { type: 'cpu', refreshInterval: 3000 },
  memory: { type: 'memory', refreshInterval: 3000 },
  disk: { type: 'disk', refreshInterval: 60_000 },
  battery: { type: 'battery', refreshInterval: 10_000 },
  weather: { type: 'weather', refreshInterval: 30 * 60_000 },
  // Approximate location for the forecast panel; it rarely changes.
  ip: { type: 'ip', refreshInterval: 6 * 3600_000 },
  network: { type: 'network', refreshInterval: 3000 },
  glazewm: { type: 'glazewm' },
  systray: { type: 'systray' },
});

export type IslandOutputs = typeof providers.outputMap;
