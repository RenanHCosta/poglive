import { useState } from 'react';
import { PeerConnections } from './PeerConnections';

export function RoomMedia({
  roomId,
  selfId,
  rtcEndpoint,
  capture,
}: {
  roomId: string;
  selfId: string;
  rtcEndpoint: { host: string; port: number };
  capture: MediaStream | null;
}) {
  const [theater, setTheater] = useState(false);
  return (
    <div className={`room-media${theater ? ' theater' : ''}`}>
      <PeerConnections
        roomId={roomId}
        selfId={selfId}
        rtcEndpoint={rtcEndpoint}
        capture={capture}
        theater={theater}
        onTheater={setTheater}
      />
    </div>
  );
}
