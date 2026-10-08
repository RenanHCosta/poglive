import { playSound } from '../sounds';
import { Store } from '../store';

/** Mute and deafen survive leaving a room, like in desktop voice apps. */
export const voicePrefs = new Store<{ selfMuted: boolean; deafened: boolean }>({
  selfMuted: false,
  deafened: false,
});

/** Toggles used while no room session exists; sessions keep their own view. */
export function toggleMutePref(): void {
  const prefs = voicePrefs.get();
  if (prefs.deafened) {
    voicePrefs.set({ selfMuted: false, deafened: false });
    void playSound('unmute');
    return;
  }
  voicePrefs.set({ ...prefs, selfMuted: !prefs.selfMuted });
  void playSound(prefs.selfMuted ? 'unmute' : 'mute');
}

export function toggleDeafenPref(): void {
  const prefs = voicePrefs.get();
  voicePrefs.set({ ...prefs, deafened: !prefs.deafened });
  void playSound(prefs.deafened ? 'undeafen' : 'deafen');
}
