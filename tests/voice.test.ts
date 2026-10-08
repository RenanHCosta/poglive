import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rmsDb,
  SILENCE_DB,
  SpeakingDetector,
  VoiceGate,
} from '../src/renderer/services/voice/levels';

test('RMS level is reported in dBFS with a silence floor', () => {
  assert.equal(rmsDb(new Float32Array(128)), SILENCE_DB);
  assert.equal(rmsDb(new Float32Array(0)), SILENCE_DB);
  const fullScale = new Float32Array(128).fill(1);
  assert.equal(Math.round(rmsDb(fullScale)), 0);
  const half = new Float32Array(128).fill(0.5);
  assert.equal(Math.round(rmsDb(half)), -6);
});

test('manual gate opens above the threshold and holds between syllables', () => {
  const gate = new VoiceGate();
  const options = { automatic: false, thresholdDb: -40 };
  assert.equal(gate.update(-60, 0, options), false);
  assert.equal(gate.update(-30, 20, options), true);
  // A short dip keeps the gate open; a long one closes it.
  assert.equal(gate.update(-70, 200, options), true);
  assert.equal(gate.update(-70, 400, options), false);
});

test('automatic gate adapts to the room noise floor', () => {
  const gate = new VoiceGate();
  const options = { automatic: true, thresholdDb: 0 };
  let now = 0;
  // A noisy room at -45 dB settles the floor without opening the gate.
  for (let index = 0; index < 2000; index++, now += 20)
    gate.update(-45, now, options);
  assert.equal(gate.update(-45, (now += 20), options), false);
  assert.ok(gate.thresholdDb > -45 && gate.thresholdDb <= -28);
  // Speech well above the floor opens it.
  assert.equal(gate.update(-20, now + 20, options), true);
  // In a quiet room the threshold stays clamped to a sensible minimum.
  const quiet = new VoiceGate();
  for (let index = 0; index < 500; index++)
    quiet.update(SILENCE_DB, index * 20, options);
  assert.equal(quiet.thresholdDb, -62);
});

test('speaking detector holds briefly after the voice stops', () => {
  const detector = new SpeakingDetector();
  assert.equal(detector.update(-80, 0), false);
  assert.equal(detector.update(-30, 10), true);
  assert.equal(detector.update(-90, 200), true);
  assert.equal(detector.update(-90, 400), false);
});
