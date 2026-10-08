import { useCallback, useEffect, useState } from 'react';
import { useAppInfo } from './hooks/useAppInfo';
import { useRoom } from './hooks/useRoom';
import { useRoomSession } from './hooks/useRoomSession';
import { useUpdater } from './hooks/useUpdater';
import { activeSession } from './services/activeSession';
import { loadSettings } from './services/settings';
import { Store, useStore } from './services/store';
import { pushToast } from './services/toasts';
import { toggleDeafenPref, toggleMutePref } from './services/voice/prefs';
import { Modal } from './components/common/Modal';
import { LinkConfirm } from './components/common/LinkConfirm';
import { Toasts } from './components/common/Toasts';
import { HomeView } from './components/home/HomeView';
import { Onboarding } from './components/home/Onboarding';
import { CreateRoomModal, JoinRoomModal } from './components/home/RoomForms';
import { Icon } from './components/Icon';
import { ServerRail } from './components/layout/ServerRail';
import { TitleBar } from './components/layout/TitleBar';
import type { OnAir } from './components/layout/TitleBar';
import { IDLE_VOICE_VIEW } from './services/voice/VoiceController';
import type { ShareState } from './services/ScreenShare';
import { UserPanel } from './components/layout/UserPanel';
import { InviteModal } from './components/room/InviteModal';
import { RoomLayout } from './components/room/RoomLayout';
import { SharePicker } from './components/room/SharePicker';
import { SettingsModal } from './components/settings/SettingsModal';

type Dialog = 'create' | 'join' | 'invite' | 'share' | 'settings' | 'leave';

const NO_UNREAD_STORE = new Store({ count: 0, mentioned: false });
const IDLE_SHARE_STATE = new Store<ShareState>({ status: 'IDLE' });

export function App() {
  const desktop = useAppInfo();
  const { view, busy, command } = useRoom();
  const updater = useUpdater();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // The room the user navigated away from (to Início); a new room shows itself.
  const [homeFor, setHomeFor] = useState<string | null>(null);
  const data = view.status === 'READY' ? view.data : null;
  const identity = data?.identity ?? null;
  const active =
    data?.room.status === 'HOSTING' || data?.room.status === 'JOINED'
      ? data.room
      : null;
  const session = useRoomSession(active?.room ?? null, identity);
  const unread = useStore(session?.chat.unread ?? NO_UNREAD_STORE);
  const voiceView = useStore(session?.voice.view ?? IDLE_VOICE_VIEW);
  const shareState = useStore(session?.share.state ?? IDLE_SHARE_STATE);
  const onAir: OnAir =
    shareState.status === 'LIVE'
      ? 'live'
      : voiceView.status === 'CONNECTED'
        ? 'voice'
        : null;
  const roomSelected = !!active && homeFor !== active.room.roomId;
  const setRoomSelected = (selected: boolean) =>
    setHomeFor(selected ? null : (active?.room.roomId ?? null));
  const close = useCallback(() => setDialog(null), []);

  useEffect(() => {
    loadSettings().catch(() =>
      pushToast('Não foi possível carregar as configurações.', 'error'),
    );
    return window.pogLive.onShortcut((action) => {
      const current = activeSession.get();
      if (action === 'SAVE_CLIP') {
        if (current) void current.clips.save();
        else pushToast('Entre em uma sala para salvar clipes.', 'info');
      } else if (action === 'TOGGLE_MUTE') {
        if (current) current.voice.toggleMute();
        else toggleMutePref();
      } else if (current) current.voice.toggleDeafen();
      else toggleDeafenPref();
    });
  }, []);

  const onShare = useCallback(() => {
    if (!session) return;
    if (session.share.state.get().status === 'LIVE') session.share.stop();
    else setDialog('share');
  }, [session]);

  const leave = async () => {
    session?.voice.leave();
    if (await command({ type: 'LEAVE_ROOM' })) setDialog(null);
  };

  const title = active
    ? roomSelected
      ? active.room.name
      : 'Início'
    : identity
      ? 'Início'
      : '';

  return (
    <div className="app">
      <TitleBar title={title} onAir={onAir}>
        {updater.state?.status === 'READY' && (
          <button
            type="button"
            className="title-update"
            data-tooltip={`Versão ${updater.state.version} pronta`}
            aria-label="Atualização pronta"
            onClick={() => setDialog('settings')}
          >
            <Icon name="download" size={16} />
          </button>
        )}
      </TitleBar>
      <div className="app-body" id="main">
        {view.status === 'LOADING' && (
          <div className="splash" role="status">
            <img src="./poglive.svg" alt="" className="splash-logo" />
            <span>Carregando…</span>
          </div>
        )}
        {view.status === 'ERROR' && (
          <div className="splash" role="alert">
            <Icon name="alert" size={32} />
            <span>{view.message}</span>
          </div>
        )}
        {data && !identity && <Onboarding busy={busy} command={command} />}
        {data && identity && (
          <div className="shell">
            <ServerRail
              roomName={active?.room.name ?? null}
              roomSelected={roomSelected}
              unread={unread}
              onHome={() => setRoomSelected(false)}
              onRoom={() => setRoomSelected(true)}
              onCreate={() => setDialog('create')}
              onJoin={() => setDialog('join')}
            />
            {active && session && roomSelected ? (
              <RoomLayout
                room={active}
                identity={identity}
                session={session}
                onInvite={() => setDialog('invite')}
                onLeave={() => setDialog('leave')}
                onSettings={() => setDialog('settings')}
                onShare={onShare}
              />
            ) : (
              <>
                <aside className="sidebar">
                  <div className="sidebar-header">Início</div>
                  <div className="sidebar-scroll">
                    <button
                      type="button"
                      className={`channel${!active ? ' selected' : ''}`}
                      onClick={() => setRoomSelected(false)}
                    >
                      <Icon name="home" size={20} className="channel-icon" />
                      <span className="channel-name">Início</span>
                    </button>
                    {active && (
                      <button
                        type="button"
                        className="channel"
                        onClick={() => setRoomSelected(true)}
                      >
                        <Icon
                          name="speaker"
                          size={20}
                          className="channel-icon"
                        />
                        <span className="channel-name">{active.room.name}</span>
                      </button>
                    )}
                  </div>
                  <UserPanel
                    identity={identity}
                    session={session}
                    onSettings={() => setDialog('settings')}
                  />
                </aside>
                <main className="content">
                  <HomeView
                    data={data}
                    inRoom={!!active}
                    onCreate={() => setDialog('create')}
                    onJoin={() => setDialog('join')}
                  />
                </main>
              </>
            )}
          </div>
        )}
      </div>
      {data && dialog === 'create' && (
        <CreateRoomModal
          data={data}
          busy={busy}
          command={command}
          onClose={close}
        />
      )}
      {dialog === 'join' && (
        <JoinRoomModal busy={busy} command={command} onClose={close} />
      )}
      {dialog === 'invite' && active?.status === 'HOSTING' && (
        <InviteModal
          roomName={active.room.name}
          invite={active.invite}
          command={command}
          onClose={close}
        />
      )}
      {dialog === 'share' && session && (
        <SharePicker session={session} onClose={close} />
      )}
      {dialog === 'leave' && active && (
        <Modal
          title={
            active.status === 'HOSTING' ? 'Encerrar a sala?' : 'Sair da sala?'
          }
          size="small"
          onClose={close}
          footer={
            <>
              <button type="button" className="button link" onClick={close}>
                Cancelar
              </button>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => void leave()}
              >
                {active.status === 'HOSTING' ? 'Encerrar para todos' : 'Sair'}
              </button>
            </>
          }
        >
          <p>
            {active.status === 'HOSTING'
              ? 'Você é o anfitrião: todos serão desconectados e o chat será apagado. O convite deixa de funcionar.'
              : `Você vai sair de ${active.room.name}. Para voltar, use o convite novamente.`}
          </p>
        </Modal>
      )}
      {dialog === 'settings' && identity && (
        <SettingsModal
          identity={identity}
          inRoom={!!active}
          appInfo={desktop.status === 'READY' ? desktop.info : null}
          command={command}
          onClose={close}
        />
      )}
      <LinkConfirm />
      <Toasts />
      <span className="sr-only" data-testid="desktop-status" role="status">
        {desktop.status === 'READY'
          ? `Desktop pronto · v${desktop.info.version}`
          : desktop.status === 'ERROR'
            ? desktop.message
            : 'Conectando ao desktop…'}
      </span>
    </div>
  );
}
