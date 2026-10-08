import { useEffect } from 'react';
import { DEFAULT_SETTINGS } from '../../shared/schemas/settings';
import type { Identity, RoomSnapshot } from '../../shared/schemas/room';
import { activeSession, useSession } from '../services/activeSession';
import { RoomSession } from '../services/RoomSession';
import { currentSettings, settingsStore } from '../services/settings';

/** Creates the session when a room opens and tears it down when it closes. */
export function useRoomSession(
  room: RoomSnapshot | null,
  identity: Identity | null,
): RoomSession | null {
  const roomId = room?.roomId;
  const host = room?.rtcEndpoint.host;
  const port = room?.rtcEndpoint.port;
  const peerId = identity?.peerId;
  const displayName = identity?.displayName;
  useEffect(() => {
    if (!roomId || !host || !port || !peerId || !displayName) return;
    const session = new RoomSession(
      roomId,
      { peerId, displayName },
      { host, port },
      currentSettings() ?? DEFAULT_SETTINGS,
    );
    activeSession.set(session);
    const stopEvents = window.pogLive.onRoomEvent((event) =>
      session.handleRoomEvent(event),
    );
    const stopSettings = settingsStore.subscribe(() => {
      const settings = currentSettings();
      if (settings) session.applySettings(settings);
    });
    return () => {
      stopEvents();
      stopSettings();
      session.close();
      if (activeSession.get() === session) activeSession.set(null);
    };
  }, [roomId, host, port, peerId, displayName]);
  const session = useSession();
  useEffect(() => {
    if (session && room && session.roomId === room.roomId)
      session.setRoster(room);
  }, [session, room]);
  return session && session.roomId === roomId ? session : null;
}
