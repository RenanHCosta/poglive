import type { QualityReport } from '../../shared/protocols/media';
import type { AdaptationSample } from './adaptiveQuality';

type StatsRecord = Record<string, unknown>;

interface InboundCounters {
  packetsReceived: number;
  packetsLost: number;
  framesDecoded: number;
  framesDropped: number;
  freezeCount: number;
  bytesReceived: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
}

export interface MediaStatsSnapshot {
  inbound: InboundCounters | null;
}

export interface CollectedMediaStats {
  report: Omit<QualityReport, 'version' | 'type' | 'streamId'> | null;
  sender: Omit<AdaptationSample, 'receiver'>;
  snapshot: MediaStatsSnapshot;
}

const EMPTY_SENDER: Omit<AdaptationSample, 'receiver'> = {
  qualityLimitationReason: null,
  availableOutgoingBitrate: null,
  roundTripMs: null,
};

function number(record: StatsRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegative(record: StatsRecord, key: string): number {
  return Math.max(0, number(record, key) ?? 0);
}

function ratio(value: number, total: number): number | null {
  return total > 0 ? Math.max(0, Math.min(1, value / total)) : null;
}

function milliseconds(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.min(60000, value * 1000));
}

function integer(
  value: number | null,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null || value < minimum) return null;
  return Math.min(maximum, Math.round(value));
}

function bounded(
  value: number | null,
  minimum: number,
  maximum: number,
): number | null {
  return value === null ? null : Math.max(minimum, Math.min(maximum, value));
}

function findReports(stats: RTCStatsReport): {
  inbound: StatsRecord | null;
  outbound: StatsRecord | null;
  remoteInbound: StatsRecord | null;
  candidate: StatsRecord | null;
} {
  let inbound: StatsRecord | null = null;
  let outbound: StatsRecord | null = null;
  let remoteInbound: StatsRecord | null = null;
  let candidate: StatsRecord | null = null;
  let selectedCandidateId: string | null = null;
  stats.forEach((raw) => {
    const report = raw as unknown as StatsRecord;
    const type = report.type;
    const kind = report.kind ?? report.mediaType;
    if (
      type === 'inbound-rtp' &&
      kind === 'video' &&
      (!inbound || number(report, 'framesDecoded') !== null)
    )
      inbound = report;
    if (
      type === 'outbound-rtp' &&
      kind === 'video' &&
      (!outbound || number(report, 'framesEncoded') !== null)
    )
      outbound = report;
    if (type === 'remote-inbound-rtp' && kind === 'video')
      remoteInbound = report;
    if (
      type === 'transport' &&
      typeof report.selectedCandidatePairId === 'string'
    )
      selectedCandidateId = report.selectedCandidatePairId;
  });
  stats.forEach((raw) => {
    const report = raw as unknown as StatsRecord;
    if (report.type !== 'candidate-pair') return;
    if (report.id === selectedCandidateId) candidate = report;
    else if (
      !candidate &&
      report.nominated === true &&
      report.state === 'succeeded'
    )
      candidate = report;
  });
  return { inbound, outbound, remoteInbound, candidate };
}

export function collectMediaStats(
  stats: RTCStatsReport,
  previous: MediaStatsSnapshot | null,
): CollectedMediaStats {
  const reports = findReports(stats);
  const inbound = reports.inbound;
  const counters: InboundCounters | null = inbound
    ? {
        packetsReceived: nonNegative(inbound, 'packetsReceived'),
        packetsLost: nonNegative(inbound, 'packetsLost'),
        framesDecoded: nonNegative(inbound, 'framesDecoded'),
        framesDropped: nonNegative(inbound, 'framesDropped'),
        freezeCount: nonNegative(inbound, 'freezeCount'),
        bytesReceived: nonNegative(inbound, 'bytesReceived'),
        jitterBufferDelay: nonNegative(inbound, 'jitterBufferDelay'),
        jitterBufferEmittedCount: nonNegative(
          inbound,
          'jitterBufferEmittedCount',
        ),
      }
    : null;
  const prior = previous?.inbound;
  const received =
    counters && prior
      ? Math.max(0, counters.packetsReceived - prior.packetsReceived)
      : 0;
  const lost =
    counters && prior
      ? Math.max(0, counters.packetsLost - prior.packetsLost)
      : 0;
  const decoded =
    counters && prior
      ? Math.max(0, counters.framesDecoded - prior.framesDecoded)
      : 0;
  const dropped =
    counters && prior
      ? Math.max(0, counters.framesDropped - prior.framesDropped)
      : 0;
  const bytes =
    counters && prior
      ? Math.max(0, counters.bytesReceived - prior.bytesReceived)
      : 0;
  const emitted =
    counters && prior
      ? Math.max(
          0,
          counters.jitterBufferEmittedCount - prior.jitterBufferEmittedCount,
        )
      : 0;
  const bufferDelay =
    counters && prior
      ? Math.max(0, counters.jitterBufferDelay - prior.jitterBufferDelay)
      : 0;
  const report = inbound
    ? {
        lossRatio: prior ? ratio(lost, received + lost) : null,
        droppedRatio: prior ? ratio(dropped, decoded + dropped) : null,
        jitterMs: milliseconds(number(inbound, 'jitter')),
        jitterBufferMs:
          prior && emitted > 0
            ? Math.min(60000, (bufferDelay / emitted) * 1000)
            : null,
        roundTripMs: milliseconds(
          number(reports.candidate, 'currentRoundTripTime'),
        ),
        framesPerSecond: bounded(number(inbound, 'framesPerSecond'), 0, 240),
        frameWidth: integer(number(inbound, 'frameWidth'), 1, 16384),
        frameHeight: integer(number(inbound, 'frameHeight'), 1, 16384),
        freezes: Math.min(
          10000,
          prior && counters
            ? Math.max(0, counters.freezeCount - prior.freezeCount)
            : 0,
        ),
        stalled: Boolean(prior && bytes > 0 && decoded === 0),
      }
    : null;
  const rawLimitation = reports.outbound?.qualityLimitationReason;
  const qualityLimitationReason =
    rawLimitation === 'none' ||
    rawLimitation === 'bandwidth' ||
    rawLimitation === 'cpu' ||
    rawLimitation === 'other'
      ? rawLimitation
      : null;
  return {
    report,
    sender: {
      ...EMPTY_SENDER,
      qualityLimitationReason,
      availableOutgoingBitrate: number(
        reports.candidate,
        'availableOutgoingBitrate',
      ),
      roundTripMs: milliseconds(
        number(reports.remoteInbound, 'roundTripTime') ??
          number(reports.candidate, 'currentRoundTripTime'),
      ),
    },
    snapshot: { inbound: counters },
  };
}
