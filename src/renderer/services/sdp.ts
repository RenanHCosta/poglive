/**
 * Media sections are negotiated in a fixed order by PeerLink, so the answer
 * mirrors the offer and sections can be addressed by m-line index.
 */
export const MEDIA_SECTION = {
  video: 0,
  streamAudio: 1,
  voice: 2,
} as const;

type OpusParameters = Record<string, string>;

const STREAM_AUDIO_OPUS: OpusParameters = {
  // Shared game/music audio benefits from stereo; Chromium sends mono otherwise.
  stereo: '1',
  'sprop-stereo': '1',
  maxaveragebitrate: '128000',
};
const VOICE_OPUS: OpusParameters = {
  // Discontinuous transmission stops sending packets while the gate is closed.
  usedtx: '1',
  useinbandfec: '1',
};

/** Adjusts Opus fmtp parameters per section; unknown layouts are left untouched. */
export function tuneOpus(sdp: string): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const sections: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('m=')) sections.push(index);
  });
  const tuned = [...lines];
  // Walk backwards so inserted lines do not shift the remaining offsets.
  for (let section = sections.length - 1; section >= 0; section--) {
    const parameters =
      section === MEDIA_SECTION.streamAudio
        ? STREAM_AUDIO_OPUS
        : section === MEDIA_SECTION.voice
          ? VOICE_OPUS
          : null;
    const start = sections[section];
    if (parameters === null || start === undefined) continue;
    if (!tuned[start]?.startsWith('m=audio ')) continue;
    const end = sections[section + 1] ?? tuned.length;
    applySection(tuned, start, end, parameters);
  }
  return tuned.join(eol);
}

function applySection(
  lines: string[],
  start: number,
  end: number,
  parameters: OpusParameters,
): void {
  let payload: string | null = null;
  let rtpmapIndex = -1;
  for (let index = start; index < end; index++) {
    const match = /^a=rtpmap:(\d+) opus\/48000\/2$/i.exec(lines[index] ?? '');
    if (match?.[1]) {
      payload = match[1];
      rtpmapIndex = index;
      break;
    }
  }
  if (!payload) return;
  const prefix = `a=fmtp:${payload} `;
  for (let index = start; index < end; index++) {
    const line = lines[index];
    if (!line?.startsWith(prefix)) continue;
    lines[index] = prefix + merge(line.slice(prefix.length), parameters);
    return;
  }
  lines.splice(rtpmapIndex + 1, 0, prefix + merge('', parameters));
}

function merge(existing: string, parameters: OpusParameters): string {
  const values = new Map<string, string>();
  for (const pair of existing.split(';')) {
    const [key, value] = pair.split('=');
    if (key?.trim() && value !== undefined)
      values.set(key.trim(), value.trim());
  }
  for (const [key, value] of Object.entries(parameters)) values.set(key, value);
  return [...values].map(([key, value]) => `${key}=${value}`).join(';');
}
