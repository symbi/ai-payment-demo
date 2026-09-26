import { isPrivateScanRecord } from './private-risk.ts';
import { INTERCEPTA_TRAIT_NAMES } from '../apps/buyer/src/intercepta-response.ts';
import type { NormalizedRiskEvidence } from './normalized-risk-evidence.ts';

const REQUIRED_SCAN_FIELDS = ['transport', 'httpStatus', 'toxicScore', 'traitsCount', 'traitLabels'] as const;
const KNOWN_TRAITS: ReadonlySet<string> = new Set(INTERCEPTA_TRAIT_NAMES);
const SYNTHETIC_FIELDS: ReadonlySet<string> = new Set([
  'synthetic', 'toxicScore', 'traitsCount', 'traitLabels', 'unknownTraitsCount',
]);

function unavailable(origin: 'LIVE' | 'SYNTHETIC'): NormalizedRiskEvidence {
  const provenance = origin === 'LIVE'
    ? { origin: 'LIVE', provider: 'intercepta' } as const
    : { origin: 'SYNTHETIC', provider: 'synthetic' } as const;
  return {
    ...provenance, available: false, traits: [],
    traitsCount: null, unknownTraitsCount: null, complete: false,
  };
}

/** Preserve the existing live guard and its property-read order. */
export function normalizeInterceptaEvidence(record: unknown): NormalizedRiskEvidence {
  try {
    if (!isPrivateScanRecord(record) || record.state !== 'completed' || record.risk?.source !== 'live') {
      return unavailable('LIVE');
    }
    const scan = record.risk.scan;
    if (!scan || !REQUIRED_SCAN_FIELDS.every(field => Object.hasOwn(scan, field))) {
      return unavailable('LIVE');
    }
    const { transport, httpStatus, toxicScore, traitsCount, traitLabels } = scan;
    if (transport !== 'received' || httpStatus !== 200 ||
        typeof toxicScore !== 'number' || !Number.isFinite(toxicScore) ||
        typeof traitsCount !== 'number' || !Number.isInteger(traitsCount) || !Array.isArray(traitLabels)) {
      return unavailable('LIVE');
    }

    // A missing own count is unknown, even when the prototype supplies zero.
    const unknownTraitsCount = Object.hasOwn(scan, 'unknownTraitsCount')
      ? scan.unknownTraitsCount ?? null : null;
    const copiedLabels: string[] = [];
    // Preserve the live unknown short-circuit: do not inspect labels again when unknown.
    // Empty copied labels mean "not copied for evaluation", not zero reported traits.
    if (unknownTraitsCount === 0) {
      for (let index = 0; index < traitLabels.length; index += 1) {
        copiedLabels.push(traitLabels[index]);
      }
    }
    return {
      origin: 'LIVE', provider: 'intercepta', available: true,
      toxicScore, traitsCount, traits: copiedLabels, unknownTraitsCount,
      complete: unknownTraitsCount === 0 && copiedLabels.length === traitsCount,
    };
  } catch {
    return unavailable('LIVE');
  }
}

/** Snapshot own data once, without property reads or accessor invocation. */
function copyOwnData(value: object, maxKeys: number): Map<string, unknown> | null {
  const keys = Reflect.ownKeys(value);
  if (keys.length > maxKeys) return null;
  const data = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== 'string') return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    data.set(key, descriptor.value);
  }
  return data;
}

/** Strict data-only synthetic adapter; never constructs or authorizes a live record. */
export function normalizeSyntheticEvidence(evidence: unknown): NormalizedRiskEvidence {
  try {
    if (typeof evidence !== 'object' || evidence === null) return unavailable('SYNTHETIC');
    const prototype = Object.getPrototypeOf(evidence);
    if (prototype !== Object.prototype && prototype !== null) return unavailable('SYNTHETIC');
    const data = copyOwnData(evidence, SYNTHETIC_FIELDS.size);
    if (!data || [...data.keys()].some(key => !SYNTHETIC_FIELDS.has(key))) {
      return unavailable('SYNTHETIC');
    }
    const toxicScore = data.get('toxicScore');
    const traitsCount = data.get('traitsCount');
    const labels = data.get('traitLabels');
    const unknownTraitsCount = data.get('unknownTraitsCount');
    if (data.get('synthetic') !== true || typeof toxicScore !== 'number' || !Number.isFinite(toxicScore) ||
        typeof traitsCount !== 'number' || !Number.isInteger(traitsCount) || traitsCount < 0 || traitsCount > 100 ||
        (unknownTraitsCount !== undefined && (typeof unknownTraitsCount !== 'number' ||
          !Number.isInteger(unknownTraitsCount) || unknownTraitsCount < 0 || unknownTraitsCount > traitsCount)) ||
        !Array.isArray(labels) || Object.getPrototypeOf(labels) !== Array.prototype) {
      return unavailable('SYNTHETIC');
    }
    const labelData = copyOwnData(labels, 21); // Up to 20 own indices plus length.
    const length = labelData?.get('length');
    if (!labelData || typeof length !== 'number' || !Number.isInteger(length) ||
        length < 0 || length > 20 || length > traitsCount || labelData.size !== length + 1) {
      return unavailable('SYNTHETIC');
    }
    const traitLabels: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const label = labelData.get(String(index));
      if (typeof label !== 'string' || !KNOWN_TRAITS.has(label)) return unavailable('SYNTHETIC');
      traitLabels.push(label);
    }
    return {
      origin: 'SYNTHETIC', provider: 'synthetic', available: true,
      toxicScore, traitsCount, traits: traitLabels, unknownTraitsCount: unknownTraitsCount ?? null,
      complete: unknownTraitsCount === 0 && traitLabels.length === traitsCount,
    };
  } catch {
    return unavailable('SYNTHETIC');
  }
}
