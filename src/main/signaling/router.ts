import type { Signal } from '../../shared/protocols/signaling';

// Host owns sender identity and the active negotiation for each unordered pair.
export class SignalRouter {
  private readonly pairs = new Map<
    string,
    { id: string; answered: boolean; started: number }
  >();
  constructor(
    private readonly roomId: string,
    private readonly members: () => Set<string>,
    private readonly deliver: (signal: Signal) => void,
  ) {}
  route(sender: string, signal: Signal): void {
    const members = this.members();
    if (
      signal.roomId !== this.roomId ||
      signal.fromPeerId !== sender ||
      !members.has(sender) ||
      sender === signal.toPeerId
    )
      throw new Error('Invalid signal sender');
    if (!members.has(signal.toPeerId)) return; // A peer may leave while ICE is in flight.
    const key = [sender, signal.toPeerId].sort().join(':');
    const pair = this.pairs.get(key);
    if (signal.type === 'WEBRTC_OFFER') {
      if (sender > signal.toPeerId) throw new Error('Invalid offer role');
      if (
        pair &&
        (pair.id === signal.negotiationId || Date.now() - pair.started < 2000)
      )
        return;
      this.pairs.set(key, {
        id: signal.negotiationId,
        answered: false,
        started: Date.now(),
      });
    } else {
      if (!pair || pair.id !== signal.negotiationId) return;
      if (signal.type === 'WEBRTC_ANSWER') {
        if (sender < signal.toPeerId || pair.answered) return;
        pair.answered = true;
      }
    }
    this.deliver({ ...signal, fromPeerId: sender });
  }
  remove(peerId: string): void {
    for (const key of this.pairs.keys())
      if (key.split(':').includes(peerId)) this.pairs.delete(key);
  }
}
