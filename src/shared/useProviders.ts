import { useSyncExternalStore } from 'react';
import type { ProviderGroup, ProviderGroupConfig } from 'zebar';

/**
 * Binds a Zebar provider group to React. The group hands out a new `outputMap`
 * object on every update, so it can serve directly as the snapshot.
 * Providers live as long as the widget, so listeners are never removed.
 */
export function useProviderGroup<T extends ProviderGroupConfig>(group: ProviderGroup<T>) {
  return useSyncExternalStore(
    (notify) => {
      group.onOutput(notify);
      return () => {};
    },
    () => group.outputMap,
  );
}
