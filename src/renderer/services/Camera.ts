import { Store } from './store';

type CameraState =
  | { status: 'OFF' | 'STARTING' }
  | { status: 'ON'; stream: MediaStream }
  | { status: 'ERROR'; message: string };

export class Camera {
  readonly state = new Store<CameraState>({ status: 'OFF' });
  private generation = 0;

  async start(): Promise<void> {
    const { status } = this.state.get();
    if (status === 'STARTING' || status === 'ON') return;
    const generation = ++this.generation;
    this.state.set({ status: 'STARTING' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (generation !== this.generation || track?.readyState !== 'live') {
        stream.getTracks().forEach((item) => item.stop());
        if (generation !== this.generation) return;
        throw new Error('Camera track unavailable');
      }
      track.onended = () => {
        if (generation !== this.generation) return;
        this.stop();
        this.state.set({
          status: 'ERROR',
          message: 'A câmera foi desconectada.',
        });
      };
      this.state.set({ status: 'ON', stream });
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.state.set({
        status: 'ERROR',
        message:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Permita o acesso à câmera nas configurações do Windows e tente novamente.'
            : 'Não foi possível abrir a câmera. Verifique se ela está conectada e disponível.',
      });
    }
  }

  stop(): void {
    this.generation++;
    const current = this.state.get();
    if (current.status === 'OFF') return;
    if (current.status === 'ON')
      for (const track of current.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    this.state.set({ status: 'OFF' });
  }
}
