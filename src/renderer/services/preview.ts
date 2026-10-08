import { MAX_PREVIEW_LENGTH } from '../../shared/schemas/chat';

const WIDTH = 320;
const HEIGHT = 180;

/** Grabs one frame of a stream as a small JPEG data URL, or null. */
export async function capturePreview(
  stream: MediaStream,
): Promise<string | null> {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') return null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  try {
    await video.play();
    if (!video.videoWidth)
      await new Promise((resolve) => setTimeout(resolve, 200));
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context || !video.videoWidth) return null;
    // Letterbox to 16:9 like the stage tiles.
    const scale = Math.min(
      WIDTH / video.videoWidth,
      HEIGHT / video.videoHeight,
    );
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    context.fillStyle = '#000';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.drawImage(
      video,
      (WIDTH - width) / 2,
      (HEIGHT - height) / 2,
      width,
      height,
    );
    for (const quality of [0.6, 0.45, 0.3]) {
      const image = canvas.toDataURL('image/jpeg', quality);
      if (image.length <= MAX_PREVIEW_LENGTH) return image;
    }
    return null;
  } catch {
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
