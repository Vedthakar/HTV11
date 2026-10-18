import {createContext, useContext, useSyncExternalStore} from 'react';
import type {MissionStore} from './store.ts';

export const MissionStoreContext = createContext<MissionStore | null>(null);

export function useMissionStore(): MissionStore {
  const store = useContext(MissionStoreContext);
  if (!store) throw new Error('useMissionStore must be used inside <MissionStoreContext.Provider>');
  return store;
}

/** Discrete playback state plus controls. Re-renders only on mode/play/speed/status changes, never per frame. */
export function useMissionPlayback() {
  const store = useMissionStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {state, store};
}
