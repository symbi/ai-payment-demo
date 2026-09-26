import express, { type ErrorRequestHandler, type Express } from 'express';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { RiskScanner } from '../../buyer/src/intercepta.ts';
import type { TaskGrantStore } from '../../buyer/src/task-grant-store.ts';
import { createTaskGrantRouter } from '../../buyer/src/task-grant-routes.ts';
import {
  CANDIDATE_NETWORK,
  isPrivateScanRecord,
  PRIVATE_SCAN_MAX_REQUESTS,
  PRIVATE_SCAN_REVISION,
  privateCandidate,
  type PrivateCandidateId,
  type PrivateScanRecord,
  type PrivateScanStatus,
} from '../../../shared/private-risk.ts';

type PrivateRiskAppOptions = {
  journalPath: string;
  scanner: RiskScanner;
  ready: boolean;
  message: string;
  html: string;
  taskGrantStore?: TaskGrantStore;
};

type Journal = { version: 1; records: PrivateScanRecord[] };
const PERSISTENCE_ERROR = '地址评估记录不可用；未执行新的扫描。';
const REQUEST_ERROR = '地址评估请求无效；未执行扫描。';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function validJournal(value: unknown): value is Journal {
  if (!object(value) || !exactKeys(value, ['version', 'records']) || value.version !== 1 || !Array.isArray(value.records)) return false;
  if (value.records.length > PRIVATE_SCAN_MAX_REQUESTS || !value.records.every(isPrivateScanRecord)) return false;
  return new Set(value.records.map(record => record.candidateId)).size === value.records.length;
}

function syncDirectory(path: string): void {
  const fd = openSync(dirname(path), 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function createJournal(path: string): Journal {
  const journal: Journal = { version: 1, records: [] };
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(journal), 'utf8'); fsyncSync(fd); }
  finally { closeSync(fd); }
  syncDirectory(path);
  return journal;
}

function readJournal(path: string): Journal {
  if (!existsSync(path)) return createJournal(path);
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown; }
  catch { throw new Error('private journal unavailable'); }
  if (!validJournal(parsed)) throw new Error('private journal unavailable');
  return parsed;
}

function writeJournal(path: string, journal: Journal): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  try {
    const fd = openSync(temporaryPath, 'wx', 0o600);
    temporaryCreated = true;
    try { writeFileSync(fd, JSON.stringify(journal), 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporaryPath, path);
    temporaryCreated = false;
    syncDirectory(path);
  } finally {
    if (temporaryCreated) {
      try { unlinkSync(temporaryPath); } catch { /* The owned temporary file may already be gone. */ }
    }
  }
}

function withJournal<T>(path: string, operation: (journal: Journal) => T): T {
  const lockPath = `${path}.lock`;
  const lockFd = openSync(lockPath, 'wx', 0o600);
  const lockIdentity = fstatSync(lockFd);
  try {
    return operation(readJournal(path));
  } finally {
    try {
      const current = lstatSync(lockPath);
      if (current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) unlinkSync(lockPath);
    } catch { /* Fail closed; never remove a lock that cannot be identified as ours. */ }
    closeSync(lockFd);
  }
}

function status(options: PrivateRiskAppOptions, records: PrivateScanRecord[]): PrivateScanStatus {
  return {
    contractRevision: PRIVATE_SCAN_REVISION,
    mode: 'private-scan-only',
    paymentEnabled: false,
    ready: options.ready,
    message: options.message,
    maxRequests: PRIVATE_SCAN_MAX_REQUESTS,
    usedRequests: records.length,
    records,
  };
}

function sanitizedRecord(candidateId: PrivateCandidateId, attemptedAt: string, raw: Awaited<ReturnType<RiskScanner>>): PrivateScanRecord {
  const scan = raw.scan && {
    transport: raw.scan.transport,
    requestedNetwork: raw.scan.requestedNetwork,
    coverage: raw.scan.coverage,
    semantics: raw.scan.semantics,
    ...(raw.scan.toxicScore === undefined ? {} : { toxicScore: raw.scan.toxicScore }),
    ...(raw.scan.traitsCount === undefined ? {} : { traitsCount: raw.scan.traitsCount }),
    ...(raw.scan.traitLabels === undefined ? {} : { traitLabels: [...raw.scan.traitLabels] }),
  };
  const risk = {
    address: raw.address,
    checkedAt: raw.checkedAt,
    provider: raw.provider,
    source: raw.source,
    decision: raw.decision,
    reasons: Array.isArray(raw.reasons) ? [...raw.reasons] : raw.reasons,
    scan,
  };
  const record: PrivateScanRecord = {
    candidateId,
    state: raw.source === 'live' ? 'completed' : 'unavailable',
    attemptedAt,
    risk,
  };
  return isPrivateScanRecord(record) ? record : { candidateId, state: 'unavailable', attemptedAt, risk: null };
}

function unavailableRecord(candidateId: PrivateCandidateId, attemptedAt: string): PrivateScanRecord {
  return { candidateId, state: 'unavailable', attemptedAt, risk: null };
}

export function createPrivateRiskApp(options: PrivateRiskAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    const host = request.get('host') ?? '';
    const origin = request.get('origin');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
      || (origin !== undefined && origin !== `http://${host}`)
      || request.get('sec-fetch-site') === 'cross-site') {
      response.status(403).json({ error: REQUEST_ERROR });
      return;
    }
    next();
  });
  if (options.taskGrantStore) app.use(createTaskGrantRouter(options.taskGrantStore));
  app.use(express.json({ limit: '16kb', strict: true }));

  app.get('/', (_request, response) => {
    response.type('html').send(options.html);
  });

  app.get('/api/private-risk/status', (_request, response) => {
    try {
      response.json(withJournal(options.journalPath, journal => status(options, journal.records)));
    } catch {
      response.status(503).json({ error: PERSISTENCE_ERROR });
    }
  });

  app.post('/api/private-risk/scan', async (request, response) => {
    if (!object(request.body) || !exactKeys(request.body, ['candidateId']) || !privateCandidate(request.body.candidateId)) {
      response.status(400).json({ error: REQUEST_ERROR });
      return;
    }
    const candidate = privateCandidate(request.body.candidateId)!;
    const attemptedAt = new Date().toISOString();
    let rejectionStatus = 0;
    let begun: PrivateScanStatus;
    try {
      begun = withJournal(options.journalPath, journal => {
        if (!options.ready) rejectionStatus = 503;
        else if (journal.records.some(record => record.state === 'pending')) rejectionStatus = 409;
        else if (journal.records.some(record => record.candidateId === candidate.id)) rejectionStatus = 409;
        else if (journal.records.length >= PRIVATE_SCAN_MAX_REQUESTS) rejectionStatus = 429;
        if (!rejectionStatus) {
          journal.records.push({ candidateId: candidate.id, state: 'pending', attemptedAt, risk: null });
          writeJournal(options.journalPath, journal);
        }
        return status(options, journal.records);
      });
    } catch {
      response.status(503).json({ error: PERSISTENCE_ERROR });
      return;
    }
    if (rejectionStatus) {
      response.status(rejectionStatus).json(begun);
      return;
    }

    let completed = unavailableRecord(candidate.id, attemptedAt);
    try {
      completed = sanitizedRecord(candidate.id, attemptedAt, await options.scanner(candidate.address, CANDIDATE_NETWORK));
    } catch { /* One failed attempt is consumed and never retried. */ }

    try {
      const latest = withJournal(options.journalPath, journal => {
        const index = journal.records.findIndex(record => record.candidateId === candidate.id && record.state === 'pending');
        if (index < 0) throw new Error('pending private scan record unavailable');
        journal.records[index] = completed;
        writeJournal(options.journalPath, journal);
        return status(options, journal.records);
      });
      response.json(latest);
    } catch {
      response.status(503).json({ error: PERSISTENCE_ERROR });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: '接口不存在。' });
  });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    response.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: REQUEST_ERROR });
  };
  app.use(errors);
  return app;
}
