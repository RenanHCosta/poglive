import { useState } from 'react';
import { CapturePanel } from './CapturePanel';
import { PeerConnections } from './PeerConnections';

export function RoomMedia({
  roomId,
  selfId,
  rtcEndpoint,
}: {
  roomId: string;
  selfId: string;
  rtcEndpoint: { host: string; port: number };
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [theater, setTheater] = useState(false);
  return (
    <div className={`room-media${theater ? ' theater' : ''}`}>
      <CapturePanel enabled onStream={setStream} />
      <PeerConnections
        roomId={roomId}
        selfId={selfId}
        rtcEndpoint={rtcEndpoint}
        capture={stream}
        theater={theater}
        onTheater={setTheater}
      />
    </div>
  );
}
