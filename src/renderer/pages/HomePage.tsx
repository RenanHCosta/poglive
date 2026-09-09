import { useState } from 'react';
import { SessionCard } from '../components/SessionCard';
import { IdentityForm } from '../components/IdentityForm';
import { RoomLobby } from '../components/RoomLobby';
import { useAppInfo } from '../hooks/useAppInfo';
import { useRoom } from '../hooks/useRoom';
import { CapturePanel } from '../components/CapturePanel';
import { RoomMedia } from '../components/RoomMedia';
import { WindowBar } from '../components/WindowBar';
import { UpdateStatus } from '../components/UpdateStatus';
import type { LocalCapture } from '../../shared/protocols/media';

export function HomePage() {
  const desktop = useAppInfo();
  const { view, action, command } = useRoom();
  const [capture, setCapture] = useState<LocalCapture | null>(null);
  const data = view.status === 'READY' ? view.data : null;
  const inRoom =
    data?.room.status === 'HOSTING' || data?.room.status === 'JOINED';
  const busy = action.status === 'BUSY' || data?.room.status === 'CONNECTING';
  return (
    <div className="app-frame">
      <div className="app-shell">
        <WindowBar />
        <main id="main">
          {view.status === 'LOADING' && (
            <p role="status">Carregando seu perfil…</p>
          )}
          {view.status === 'ERROR' && (
            <p role="alert" className="error-message">
              {view.message}
            </p>
          )}
          {data && (
            <>
              <IdentityForm
                key={data.identity?.peerId ?? 'new'}
                identity={data.identity}
                disabled={busy || inRoom}
                save={(displayName) =>
                  command({ type: 'SAVE_IDENTITY', displayName })
                }
              />
              {data.room.status === 'DISCONNECTED' && (
                <p className="error-message" role="alert">
                  {data.room.message}
                </p>
              )}
              {data.identity && (
                <div className="workspace">
                  <div className="room-sidebar">
                    {inRoom ? (
                      <SessionCard data={data} busy={busy} command={command} />
                    ) : (
                      <RoomLobby data={data} busy={busy} command={command} />
                    )}
                    {data.room.status === 'HOSTING' ||
                    data.room.status === 'JOINED' ? (
                      <CapturePanel
                        key={data.room.room.roomId}
                        enabled
                        onCapture={setCapture}
                      />
                    ) : (
                      <CapturePanel key="disabled" enabled={false} />
                    )}
                  </div>
                  {data.room.status === 'HOSTING' ||
                  data.room.status === 'JOINED' ? (
                    <RoomMedia
                      key={data.room.room.roomId}
                      roomId={data.room.room.roomId}
                      selfId={data.identity.peerId}
                      rtcEndpoint={data.room.room.rtcEndpoint}
                      capture={capture}
                    />
                  ) : null}
                </div>
              )}
            </>
          )}
        </main>
        <div className="bottom-bar">
          <div
            className={
              action.status === 'ERROR'
                ? 'error-message action-status'
                : 'action-status'
            }
            role={action.status === 'ERROR' ? 'alert' : 'status'}
          >
            {action.status === 'BUSY'
              ? 'Conectando… aguarde.'
              : action.status === 'ERROR' || action.status === 'DONE'
                ? action.message
                : ''}
          </div>
          <UpdateStatus inRoom={inRoom} />
          <footer className="app-footer">
            <span data-testid="desktop-status" role="status">
              {desktop.status === 'READY'
                ? `Desktop pronto · v${desktop.info.version} · ${desktop.info.platform}/${desktop.info.arch}`
                : desktop.status === 'ERROR'
                  ? desktop.message
                  : 'Conectando ao desktop…'}
            </span>
            <span>Salas locais · Sem conta</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
