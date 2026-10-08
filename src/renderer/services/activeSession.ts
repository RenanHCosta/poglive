import type { RoomSession } from './RoomSession';
import { Store, useStore } from './store';

/** The session for the room currently open, if any. */
export const activeSession = new Store<RoomSession | null>(null);

export function useSession(): RoomSession | null {
  return useStore(activeSession);
}
