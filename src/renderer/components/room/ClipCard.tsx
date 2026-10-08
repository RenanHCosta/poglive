import { useState } from 'react';
import type { ClipAttachment } from '../../../shared/schemas/chat';
import type { RoomSession } from '../../services/RoomSession';
import { useStore } from '../../services/store';
import { pushToast } from '../../services/toasts';
import { Icon } from '../Icon';

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A clip posted in chat, fetched peer to peer from its author on demand. */
export function ClipCard({
  session,
  authorId,
  attachment,
}: {
  session: RoomSession;
  authorId: string;
  attachment: ClipAttachment;
}) {
  const download = useStore(session.clipShare.downloads).get(attachment.id);
  const own = authorId === session.self.peerId;
  const [saving, setSaving] = useState(false);
  const save = async (bytes: Uint8Array) => {
    setSaving(true);
    try {
      const result = await window.pogLive.saveClip(bytes, attachment.name);
      if (result.status === 'ERROR') pushToast(result.message, 'error');
      else
        pushToast(`Clipe salvo: ${result.fileName}`, 'success', {
          label: 'Mostrar',
          run: () => void window.pogLive.revealClip(result.fileName),
        });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="clip-card">
      <div className="clip-card-header">
        <span className="clip-card-icon">
          <Icon name="clip" size={18} />
        </span>
        <div className="clip-card-meta">
          <strong>{attachment.name}</strong>
          <span>
            {formatDuration(attachment.durationMs)} ·{' '}
            {formatSize(attachment.size)}
          </span>
        </div>
      </div>
      {download?.status === 'READY' ? (
        <>
          <video
            className="clip-card-video"
            src={download.url}
            controls
            playsInline
            preload="metadata"
          />
          {!own && (
            <button
              type="button"
              className="button secondary small-wide"
              disabled={saving}
              onClick={() => void save(download.bytes)}
            >
              <Icon name="download" size={16} />
              Salvar no PC
            </button>
          )}
        </>
      ) : download?.status === 'LOADING' ? (
        <div
          className="clip-card-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(download.progress * 100)}
        >
          <i style={{ width: `${Math.round(download.progress * 100)}%` }} />
          <span>Recebendo… {Math.round(download.progress * 100)}%</span>
        </div>
      ) : (
        <>
          {download?.status === 'ERROR' && (
            <p className="clip-card-error">{download.message}</p>
          )}
          <button
            type="button"
            className="button primary small-wide"
            onClick={() => session.clipShare.open(authorId, attachment)}
          >
            <Icon name="eye" size={16} />
            {download?.status === 'ERROR' ? 'Tentar de novo' : 'Assistir clipe'}
          </button>
        </>
      )}
    </div>
  );
}
