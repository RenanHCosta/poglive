import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuneOpus } from '../src/renderer/services/sdp';

const offer = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:0',
  'a=rtpmap:96 VP8/90000',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=mid:1',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:2',
  'a=rtpmap:111 opus/48000/2',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=mid:3',
  '',
].join('\r\n');

test('stream audio negotiates stereo Opus and voice enables DTX', () => {
  const tuned = tuneOpus(offer);
  const lines = tuned.split('\r\n');
  const streamSection = lines.slice(
    lines.indexOf('a=mid:1'),
    lines.indexOf('a=mid:2'),
  );
  assert.ok(
    streamSection.includes(
      'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000',
    ),
  );
  const voiceSection = lines.slice(
    lines.indexOf('a=mid:2'),
    lines.indexOf('a=mid:3'),
  );
  assert.ok(voiceSection.includes('a=fmtp:111 usedtx=1;useinbandfec=1'));
  // The video and data sections are not modified.
  assert.equal(lines.filter((line) => line.startsWith('a=fmtp:')).length, 2);
  assert.ok(tuned.endsWith('\r\n'));
});

test('tuning is idempotent and ignores layouts without Opus', () => {
  const once = tuneOpus(offer);
  assert.equal(tuneOpus(once), once);
  const withoutOpus = offer.replaceAll('opus/48000/2', 'PCMU/8000');
  assert.equal(tuneOpus(withoutOpus), withoutOpus);
});
