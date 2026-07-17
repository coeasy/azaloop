import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  ArtifactResetRequestSchema,
  ArtifactResetResultSchema,
  type ArtifactResetRequest,
  type ArtifactResetResult,
} from '@azaloop/shared';

const STATE_ARTIFACTS = ['STATE.yaml', 'STATE.CHECKSUM', 'STATE.HASH'] as const;
const RESET_ARTIFACTS = [
  'RESUME.md',
  'design.md',
  'design.prev.md',
  'build-complete.marker',
  'quality-passed.marker',
  'task-epoch',
  'chosen-plan.json',
  'chosen-plan.md',
  ...STATE_ARTIFACTS,
] as const;
const LOCK_FILE = '.artifact-reset.lock';
const RECOVERY_CLAIM_FILE = '.artifact-reset.recovery-claim';
const LOCK_LEASE_MS = 60_000;

type ArtifactResetPhase = 'lock' | 'prepare' | 'commit' | 'rollback';

export class ArtifactResetError extends Error {
  readonly phase: ArtifactResetPhase;
  release_error?: unknown;

  constructor(phase: ArtifactResetPhase, message: string, options?: ErrorOptions) {
    super(`Artifact reset ${phase} failed: ${message}`, options);
    this.name = 'ArtifactResetError';
    this.phase = phase;
  }
}

/** Failure-injection sentinel that models a process disappearing without rollback. */
export class ArtifactResetProcessCrash extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactResetProcessCrash';
  }
}

export interface ArtifactResetHooks {
  resetState(): Promise<void>;
  clearRuntime(): void | Promise<void>;
  /** Transaction port used by failure-injection tests. */
  writeEpoch?(epochPath: string, fingerprint: string): Promise<void>;
  /** Controlled stale-recovery barrier used by concurrency tests. */
  onRecoveryClaimed?(): void | Promise<void>;
  /** Release port used to verify committed-result warning semantics. */
  releaseLease?(lock: ResetLock): Promise<void>;
  /** Process-crash injection point after a prepared artifact move. */
  onArtifactMoved?(artifact: string, movedCount: number): void | Promise<void>;
  /** Process-crash injection point while replaying an abandoned transaction. */
  onAbandonedArtifactRestored?(artifact: string, restoredCount: number): void | Promise<void>;
}

export interface ResetLock {
  path: string;
  owner: string;
}

interface PreparedReset {
  tempDir: string;
  historyDir: string;
  moved: string[];
  historyCommitted: boolean;
  epochPublished: boolean;
  stateResetStarted: boolean;
}

interface ResetTransactionManifest {
  version: 1;
  transaction_id: string;
  reason: ArtifactResetRequest['reason'];
  next_fingerprint: string;
  candidates: string[];
  status: 'preparing';
  prepared_at: string;
}

async function lstatOrNull(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(filePath: string): Promise<boolean> {
  return (await lstatOrNull(filePath)) !== null;
}

function assertDirectChild(azaDir: string, name: string): string {
  const child = path.resolve(azaDir, name);
  if (path.dirname(child) !== path.resolve(azaDir)) {
    throw new ArtifactResetError('prepare', `artifact path escapes .aza: ${name}`);
  }
  return child;
}

async function validateResetPaths(azaDir: string): Promise<void> {
  const azaStat = await lstatOrNull(azaDir);
  if (azaStat?.isSymbolicLink()) {
    throw new ArtifactResetError('prepare', '.aza must not be a symbolic link');
  }

  for (const name of ['history', LOCK_FILE, RECOVERY_CLAIM_FILE, ...RESET_ARTIFACTS]) {
    const target = assertDirectChild(azaDir, name);
    const stat = await lstatOrNull(target);
    if (stat?.isSymbolicLink()) {
      throw new ArtifactResetError('prepare', `symbolic links are forbidden: ${name}`);
    }
  }

  let entries: string[];
  try {
    entries = await fs.readdir(azaDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const name of entries) {
    const isResetControlPath =
      name.startsWith(`${LOCK_FILE}.`) || name.startsWith(`${RECOVERY_CLAIM_FILE}.`);
    if (!isResetControlPath) continue;
    const stat = await fs.lstat(assertDirectChild(azaDir, name));
    if (stat.isSymbolicLink()) {
      throw new ArtifactResetError('prepare', `symbolic reset control path is forbidden: ${name}`);
    }
  }
}

interface LeaseRecord {
  owner: string;
  pid: number;
  expires_at: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function parseLease(raw: string, label: string): LeaseRecord {
  let candidate: Partial<LeaseRecord>;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    throw new ArtifactResetError('lock', `${label} is unreadable`, { cause: error });
  }
  if (
    typeof candidate.owner !== 'string' ||
    typeof candidate.pid !== 'number' ||
    !Number.isInteger(candidate.pid) ||
    typeof candidate.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(candidate.expires_at))
  ) {
    throw new ArtifactResetError('lock', `${label} is invalid`);
  }
  return candidate as LeaseRecord;
}

function leaseIsActive(lease: LeaseRecord): boolean {
  return Date.parse(lease.expires_at) > Date.now() || isProcessAlive(lease.pid);
}

async function readLeaseDirectory(
  claimPath: string,
  label: string,
): Promise<{ raw: string; lease: LeaseRecord }> {
  const stat = await fs.lstat(claimPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ArtifactResetError('lock', `${label} is not a safe directory`);
  }
  const leasePath = path.join(claimPath, 'lease.json');
  const leaseStat = await fs.lstat(leasePath);
  if (!leaseStat.isFile() || leaseStat.isSymbolicLink()) {
    throw new ArtifactResetError('lock', `${label} lease is not a safe file`);
  }
  const raw = await fs.readFile(leasePath, 'utf8');
  return { raw, lease: parseLease(raw, label) };
}

async function clearExpiredRecoveryClaim(azaDir: string): Promise<void> {
  const claimPath = assertDirectChild(azaDir, RECOVERY_CLAIM_FILE);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await exists(claimPath))) return;
    let observedRaw: string;
    let claim: LeaseRecord;
    try {
      ({ raw: observedRaw, lease: claim } = await readLeaseDirectory(
        claimPath,
        'recovery claim',
      ));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (leaseIsActive(claim)) {
      throw new ArtifactResetError('lock', 'another contender owns stale-lock recovery');
    }

    const observedOwner = createHash('sha256').update(claim.owner).digest('hex').slice(0, 16);
    const quarantineDir = assertDirectChild(
      azaDir,
      `${RECOVERY_CLAIM_FILE}.stale-${observedOwner}`,
    );
    try {
      // A non-empty directory cannot be replaced by rename on Windows or
      // POSIX. Moving the complete claim directory is therefore both the
      // cleanup election and the cleanup itself, with no unlink crash gap.
      await fs.rename(claimPath, quarantineDir);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (!(await exists(claimPath))) return;
      let currentRaw: string;
      try {
        ({ raw: currentRaw } = await readLeaseDirectory(claimPath, 'recovery claim'));
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw readError;
      }
      if (currentRaw !== observedRaw) continue;
      if (await exists(quarantineDir)) {
        throw new ArtifactResetError(
          'lock',
          'expired recovery-claim quarantine already exists; refusing to move the fixed claim',
          { cause: error },
        );
      }
      throw new ArtifactResetError('lock', 'expired recovery claim cleanup failed', {
        cause: error,
      });
    }
  }
  throw new ArtifactResetError('lock', 'recovery claim changed repeatedly');
}

async function publishRecoveryClaim(
  azaDir: string,
  owner: string,
  expectedLock: string,
): Promise<string> {
  const claimPath = assertDirectChild(azaDir, RECOVERY_CLAIM_FILE);
  const tempPath = assertDirectChild(azaDir, `${RECOVERY_CLAIM_FILE}.${owner}.tmp`);
  const now = Date.now();
  const claim = JSON.stringify({
    owner,
    pid: process.pid,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + LOCK_LEASE_MS).toISOString(),
    expected_lock_sha256: createHash('sha256').update(expectedLock).digest('hex'),
  });
  await fs.mkdir(tempPath);
  try {
    await fs.writeFile(path.join(tempPath, 'lease.json'), claim, {
      encoding: 'utf8',
      flag: 'wx',
    });
    // Renaming a complete, non-empty directory to the fixed path is an atomic
    // publication. An existing non-empty fixed claim cannot be overwritten.
    await fs.rename(tempPath, claimPath);
    return claimPath;
  } finally {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
}

async function releaseRecoveryClaim(claimPath: string, owner: string): Promise<void> {
  const { lease: claim } = await readLeaseDirectory(claimPath, 'recovery claim');
  if (claim.owner !== owner) {
    throw new ArtifactResetError('lock', 'recovery claim owner changed');
  }
  const releasedPath = `${claimPath}.released-${owner}`;
  await fs.rename(claimPath, releasedPath);
  await fs.rm(releasedPath, { recursive: true, force: true });
}

async function acquireLock(
  azaDir: string,
  owner: string,
  onRecoveryClaimed?: () => void | Promise<void>,
): Promise<ResetLock> {
  await fs.mkdir(azaDir, { recursive: true });
  const lockPath = assertDirectChild(azaDir, LOCK_FILE);
  const createLease = async (): Promise<ResetLock> => {
    const now = Date.now();
    const tempPath = assertDirectChild(azaDir, `${LOCK_FILE}.${owner}.tmp`);
    await fs.mkdir(tempPath);
    try {
      await fs.writeFile(
        path.join(tempPath, 'lease.json'),
        JSON.stringify({
          owner,
          pid: process.pid,
          acquired_at: new Date(now).toISOString(),
          expires_at: new Date(now + LOCK_LEASE_MS).toISOString(),
        }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await fs.rename(tempPath, lockPath);
      return { path: lockPath, owner };
    } finally {
      await fs.rm(tempPath, { recursive: true, force: true });
    }
  };

  await clearExpiredRecoveryClaim(azaDir);
  try {
    return await createLease();
  } catch (error) {
    if (await exists(lockPath)) {
      const { raw: expectedLock, lease } = await readLeaseDirectory(
        lockPath,
        'artifact reset lease',
      );
      if (leaseIsActive(lease)) {
        throw new ArtifactResetError('lock', 'another artifact reset owns the .aza lease', {
          cause: error,
        });
      }

      let claimPath: string;
      try {
        claimPath = await publishRecoveryClaim(azaDir, owner, expectedLock);
      } catch (claimError) {
        if (await exists(assertDirectChild(azaDir, RECOVERY_CLAIM_FILE))) {
          await clearExpiredRecoveryClaim(azaDir);
          throw new ArtifactResetError('lock', 'another contender won stale-lock recovery', {
            cause: claimError,
          });
        }
        throw claimError;
      }

      let recoveredLease: ResetLock | undefined;
      try {
        await onRecoveryClaimed?.();
        // CAS-equivalent identity check while the winner claim excludes every
        // legal contender from creating or recovering a lock.
        if ((await readLeaseDirectory(lockPath, 'artifact reset lease')).raw !== expectedLock) {
          throw new ArtifactResetError('lock', 'stale lock changed after recovery election');
        }
        const staleOwner = createHash('sha256').update(lease.owner).digest('hex').slice(0, 16);
        const staleLockPath = assertDirectChild(
          azaDir,
          `${LOCK_FILE}.stale-${staleOwner}`,
        );
        await fs.rename(lockPath, staleLockPath);
        recoveredLease = await createLease();
        await releaseRecoveryClaim(claimPath, owner);
        return recoveredLease;
      } catch (recoveryError) {
        if (recoveredLease) {
          try {
            await assertLockOwner(recoveredLease);
            await releaseLock(recoveredLease);
          } catch (cleanupError) {
            throw new ArtifactResetError(
              'lock',
              'stale recovery failed after the new lease was created and cleanup also failed',
              { cause: new AggregateError([recoveryError, cleanupError]) },
            );
          }
        }
        try {
          if (await exists(claimPath)) await releaseRecoveryClaim(claimPath, owner);
        } catch {
          // The original recovery error remains authoritative.
        }
        throw recoveryError;
      }
    }
    throw new ArtifactResetError(
      'lock',
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

async function assertLockOwner(lock: ResetLock): Promise<void> {
  let owner: unknown;
  try {
    owner = (await readLeaseDirectory(lock.path, 'artifact reset lease')).lease.owner;
  } catch (error) {
    throw new ArtifactResetError('lock', 'cannot verify artifact reset lease owner', {
      cause: error,
    });
  }
  if (owner !== lock.owner) {
    throw new ArtifactResetError('lock', 'artifact reset lease owner changed');
  }
}

async function releaseLock(lock: ResetLock): Promise<void> {
  await assertLockOwner(lock);
  const releasedPath = `${lock.path}.released-${lock.owner}`;
  await fs.rename(lock.path, releasedPath);
  await fs.rm(releasedPath, { recursive: true, force: true });
}

function historyName(owner: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${owner}`;
}

function createPrepared(azaDir: string, owner: string): PreparedReset {
  const historyRoot = assertDirectChild(azaDir, 'history');
  const name = historyName(owner);
  return {
    tempDir: path.join(historyRoot, `.${name}.tmp`),
    historyDir: path.join(historyRoot, name),
    moved: [],
    historyCommitted: false,
    epochPublished: false,
    stateResetStarted: false,
  };
}

async function writeJsonCreateAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
    });
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

function parseTransactionManifest(raw: string, source: string): ResetTransactionManifest {
  let value: Partial<ResetTransactionManifest>;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new ArtifactResetError('rollback', `abandoned transaction manifest is unreadable: ${source}`, {
      cause: error,
    });
  }
  const allowedArtifacts = new Set<string>(RESET_ARTIFACTS);
  if (
    value.version !== 1 ||
    typeof value.transaction_id !== 'string' ||
    typeof value.reason !== 'string' ||
    typeof value.next_fingerprint !== 'string' ||
    value.status !== 'preparing' ||
    typeof value.prepared_at !== 'string' ||
    !Array.isArray(value.candidates) ||
    value.candidates.some((name) => typeof name !== 'string' || !allowedArtifacts.has(name)) ||
    new Set(value.candidates).size !== value.candidates.length
  ) {
    throw new ArtifactResetError('rollback', `abandoned transaction manifest is invalid: ${source}`);
  }
  return value as ResetTransactionManifest;
}

function abandonedHistoryPath(historyRoot: string, tempName: string): string {
  const visibleName = tempName.slice(1, -'.tmp'.length);
  if (!visibleName) {
    throw new ArtifactResetError('rollback', `invalid abandoned transaction directory: ${tempName}`);
  }
  return path.join(historyRoot, visibleName);
}

async function recoverAbandonedTransactions(
  azaDir: string,
  lock: ResetLock,
  onRestored?: (artifact: string, restoredCount: number) => void | Promise<void>,
): Promise<void> {
  const historyRoot = assertDirectChild(azaDir, 'history');
  let names: string[];
  try {
    names = await fs.readdir(historyRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new ArtifactResetError('rollback', 'cannot scan abandoned reset transactions', {
      cause: error,
    });
  }

  const allowedArtifacts = new Set<string>(RESET_ARTIFACTS);
  for (const name of names.filter((entry) => entry.startsWith('.') && entry.endsWith('.tmp')).sort()) {
    await assertLockOwner(lock);
    const tempDir = path.join(historyRoot, name);
    const stat = await fs.lstat(tempDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ArtifactResetError('rollback', `abandoned transaction is not a safe directory: ${name}`);
    }

    const manifestPath = path.join(tempDir, 'transaction.json');
    let manifest: ResetTransactionManifest | undefined;
    try {
      manifest = parseTransactionManifest(await fs.readFile(manifestPath, 'utf8'), manifestPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      const entryStat = await fs.lstat(path.join(tempDir, entry));
      if (entryStat.isSymbolicLink()) {
        throw new ArtifactResetError(
          'rollback',
          `symbolic abandoned transaction entry is forbidden: ${entry}`,
        );
      }
    }
    const actualArtifacts = entries.filter((entry) => allowedArtifacts.has(entry));
    const unexpected = entries.filter(
      (entry) =>
        !allowedArtifacts.has(entry) &&
        entry !== 'transaction.json' &&
        entry !== 'reset-audit.json' &&
        entry !== 'aborted-audit.json' &&
        !/^transaction\.json\..+\.tmp$/.test(entry),
    );
    if (unexpected.length > 0) {
      throw new ArtifactResetError(
        'rollback',
        `abandoned transaction contains unexpected entries: ${unexpected.join(', ')}`,
      );
    }
    if (!manifest && actualArtifacts.length > 0) {
      throw new ArtifactResetError(
        'rollback',
        'abandoned transaction has artifacts but no write-ahead manifest',
      );
    }
    if (manifest) {
      const unrecorded = actualArtifacts.filter((artifact) => !manifest!.candidates.includes(artifact));
      if (unrecorded.length > 0) {
        throw new ArtifactResetError(
          'rollback',
          `abandoned transaction contains unrecorded artifacts: ${unrecorded.join(', ')}`,
        );
      }
    }

    const restored: string[] = [];
    for (const artifact of RESET_ARTIFACTS) {
      const source = path.join(tempDir, artifact);
      if (!(await exists(source))) continue;
      await assertLockOwner(lock);
      const destination = assertDirectChild(azaDir, artifact);
      if (await exists(destination)) {
        throw new ArtifactResetError(
          'rollback',
          `refusing to overwrite root artifact during abandoned recovery: ${artifact}`,
        );
      }
      await fs.rename(source, destination);
      restored.push(artifact);
      await onRestored?.(artifact, restored.length);
    }

    const abortedAuditPath = path.join(tempDir, 'aborted-audit.json');
    if (!(await exists(abortedAuditPath))) {
      await writeJsonCreateAtomic(abortedAuditPath, {
        transaction_id: manifest?.transaction_id ?? name.slice(1, -'.tmp'.length),
        status: 'aborted',
        recovery: manifest ? 'write_ahead_replay' : 'interrupted_before_manifest',
        restored,
        aborted_at: new Date().toISOString(),
      });
    }
    const visibleDir = abandonedHistoryPath(historyRoot, name);
    if (await exists(visibleDir)) {
      throw new ArtifactResetError(
        'rollback',
        `abandoned transaction audit destination already exists: ${path.basename(visibleDir)}`,
      );
    }
    await fs.rename(tempDir, visibleDir);
  }
}

async function prepareReset(
  request: ArtifactResetRequest,
  owner: string,
  prepared: PreparedReset,
  onArtifactMoved?: (artifact: string, movedCount: number) => void | Promise<void>,
): Promise<void> {
  const historyRoot = assertDirectChild(request.aza_dir, 'history');
  await fs.mkdir(historyRoot, { recursive: true });
  await fs.mkdir(prepared.tempDir);

  const candidates: string[] = [];
  for (const artifact of RESET_ARTIFACTS) {
    if (await exists(assertDirectChild(request.aza_dir, artifact))) candidates.push(artifact);
  }
  const manifest: ResetTransactionManifest = {
    version: 1,
    transaction_id: owner,
    reason: request.reason,
    next_fingerprint: request.next_fingerprint,
    candidates,
    status: 'preparing',
    prepared_at: new Date().toISOString(),
  };
  await writeJsonCreateAtomic(path.join(prepared.tempDir, 'transaction.json'), manifest);

  for (const artifact of RESET_ARTIFACTS) {
    if (!candidates.includes(artifact)) continue;
    const source = assertDirectChild(request.aza_dir, artifact);
    if (!(await exists(source))) continue;
    await fs.rename(source, path.join(prepared.tempDir, artifact));
    prepared.moved.push(artifact);
    await onArtifactMoved?.(artifact, prepared.moved.length);
  }

  await fs.writeFile(
    path.join(prepared.tempDir, 'reset-audit.json'),
    JSON.stringify(
      {
        transaction_id: owner,
        reason: request.reason,
        next_fingerprint: request.next_fingerprint,
        moved: prepared.moved,
        prepared_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function writeEpochAtomic(epochPath: string, fingerprint: string): Promise<void> {
  const tempPath = `${epochPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, fingerprint, 'utf8');
    await fs.rename(tempPath, epochPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function rollbackTransaction(
  request: ArtifactResetRequest,
  lock: ResetLock,
  prepared: PreparedReset,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await assertLockOwner(lock);
  } catch (error) {
    throw new ArtifactResetError('rollback', 'lease ownership was lost; refusing destructive rollback', {
      cause: error,
    });
  }

  if (prepared.epochPublished) {
    try {
      await fs.rm(assertDirectChild(request.aza_dir, 'task-epoch'), { force: true });
    } catch (error) {
      errors.push(error);
    }
  }

  if (prepared.stateResetStarted) {
    for (const name of STATE_ARTIFACTS) {
      try {
        await fs.rm(assertDirectChild(request.aza_dir, name), { force: true });
      } catch (error) {
        errors.push(error);
      }
    }
  }

  const sourceDir = prepared.historyCommitted ? prepared.historyDir : prepared.tempDir;
  if (await exists(sourceDir)) {
    for (const name of prepared.moved) {
      const source = path.join(sourceDir, name);
      try {
        if (!(await exists(source))) continue;
        const destination = assertDirectChild(request.aza_dir, name);
        if (await exists(destination)) {
          throw new Error(`refusing to overwrite during rollback: ${name}`);
        }
        await fs.rename(source, destination);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 0) {
      try {
        const abortedAuditPath = path.join(sourceDir, 'aborted-audit.json');
        if (!(await exists(abortedAuditPath))) {
          await writeJsonCreateAtomic(abortedAuditPath, {
            status: 'aborted',
            transaction_id: path.basename(prepared.historyDir),
            restored: prepared.moved,
            aborted_at: new Date().toISOString(),
          });
        }
        if (!prepared.historyCommitted) {
          if (await exists(prepared.historyDir)) {
            throw new Error('refusing to overwrite rollback audit history');
          }
          await fs.rename(prepared.tempDir, prepared.historyDir);
          prepared.historyCommitted = true;
        }
      } catch (error) {
        errors.push(error);
      }
    }
  }

  if (errors.length > 0) {
    throw new ArtifactResetError(
      'rollback',
      `${errors.length} rollback operation(s) failed`,
      { cause: new AggregateError(errors) },
    );
  }
}

export async function hasResidualTaskArtifacts(azaDir: string): Promise<boolean> {
  for (const artifact of RESET_ARTIFACTS) {
    if (await exists(assertDirectChild(path.resolve(azaDir), artifact))) return true;
  }
  return false;
}

export async function resetArtifacts(
  rawRequest: ArtifactResetRequest,
  hooks: ArtifactResetHooks,
): Promise<ArtifactResetResult> {
  const parsed = ArtifactResetRequestSchema.parse(rawRequest);
  const request = { ...parsed, aza_dir: path.resolve(parsed.aza_dir) };
  await validateResetPaths(request.aza_dir);

  const owner = randomUUID();
  const lock = await acquireLock(request.aza_dir, owner, hooks.onRecoveryClaimed);
  const prepared = createPrepared(request.aza_dir, owner);
  let primaryError: unknown;
  let result: ArtifactResetResult | undefined;

  try {
    await validateResetPaths(request.aza_dir);
    await assertLockOwner(lock);
    await recoverAbandonedTransactions(
      request.aza_dir,
      lock,
      hooks.onAbandonedArtifactRestored,
    );
    await assertLockOwner(lock);
    try {
      await prepareReset(request, owner, prepared, hooks.onArtifactMoved);
    } catch (error) {
      if (error instanceof ArtifactResetProcessCrash) throw error;
      await rollbackTransaction(request, lock, prepared);
      throw new ArtifactResetError(
        'prepare',
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }

    try {
      await hooks.clearRuntime();
      await assertLockOwner(lock);
      await fs.rename(prepared.tempDir, prepared.historyDir);
      prepared.historyCommitted = true;

      const epochPath = assertDirectChild(request.aza_dir, 'task-epoch');
      await (hooks.writeEpoch ?? writeEpochAtomic)(epochPath, request.next_fingerprint);
      prepared.epochPublished = true;

      prepared.stateResetStarted = true;
      await hooks.resetState();

      result = ArtifactResetResultSchema.parse({
        committed: true,
        non_retryable: true,
        warnings: [],
        transaction_id: owner,
        history_dir: prepared.historyDir,
        moved: prepared.moved,
        new_fingerprint: request.next_fingerprint,
        reason: request.reason,
      });
    } catch (error) {
      try {
        await rollbackTransaction(request, lock, prepared);
      } catch (rollbackError) {
        throw rollbackError;
      }
      throw new ArtifactResetError(
        'commit',
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  } catch (error) {
    primaryError = error;
  }

  let releaseError: unknown;
  try {
    await (hooks.releaseLease ?? releaseLock)(lock);
  } catch (error) {
    releaseError = error;
  }

  if (primaryError !== undefined) {
    const authoritative =
      primaryError instanceof ArtifactResetError
        ? primaryError
        : new ArtifactResetError(
            'commit',
            primaryError instanceof Error ? primaryError.message : String(primaryError),
            { cause: primaryError },
          );
    if (releaseError !== undefined) authoritative.release_error = releaseError;
    throw authoritative;
  }

  if (!result) {
    throw new ArtifactResetError('commit', 'transaction produced no committed result');
  }
  if (releaseError !== undefined) {
    result.warnings.push(
      `Committed successfully, but reset lease release failed: ${
        releaseError instanceof Error ? releaseError.message : String(releaseError)
      }`,
    );
  }
  return result;
}
