import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function computeChecksum(content: string): Promise<string> {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function computeFileChecksum(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf8');
  return computeChecksum(content);
}

export async function verifyChecksum(filePath: string, expected: string): Promise<boolean> {
  try {
    const actual = await computeFileChecksum(filePath);
    return actual === expected;
  } catch {
    return false;
  }
}

/**
 * Result of an attestation verification.
 */
export interface AttestationResult {
  /** Whether the content matches the attested hash. */
  verified: boolean;
  /** The expected (attested) SHA-256 hash, present when verification fails. */
  expected?: string;
  /** The actual SHA-256 hash of the supplied content, present when verification fails. */
  actual?: string;
}

/**
 * On-disk record for a locked attestation.
 */
interface AttestationRecord {
  /** The locked SHA-256 hash. */
  hash: string;
  /** ISO timestamp when the attestation was locked. */
  attested_at: string;
}

/**
 * Default cache directory for persisted attestations.
 */
export const DEFAULT_ATTESTATION_CACHE_DIR = path.join('.aza', 'checksums');

/**
 * File name used to persist the locked plan attestation.
 */
const ATTESTATION_FILE = 'plan.attestation.json';

/**
 * The {@link ChecksumStore} provides generic key/value checksum storage
 * plus an L2 SHA-256 attestation mechanism for plan integrity.
 *
 * Attestation works as a "lock" — once a plan is attested its SHA-256 hash is
 * computed, held in memory, and persisted to the `.aza/checksums/` cache
 * directory. Subsequent content can be verified against the locked hash to
 * detect tampering or drift.
 */
export class ChecksumStore {
  private checksums: Map<string, string> = new Map();
  /** The locked attestation hash, or `null` when nothing is attested. */
  private attestedHash: string | null = null;
  /** ISO timestamp of when the attestation was locked. */
  private attestedAt: string | null = null;
  /** Directory used to persist attestations to disk. */
  private cacheDir: string;

  /**
   * @param cacheDir  Directory used to persist attestations.
   *                  Defaults to `.aza/checksums/`.
   */
  constructor(cacheDir: string = DEFAULT_ATTESTATION_CACHE_DIR) {
    this.cacheDir = cacheDir;
  }

  set(key: string, checksum: string): void {
    this.checksums.set(key, checksum);
  }

  get(key: string): string | undefined {
    return this.checksums.get(key);
  }

  verify(key: string, content: string): boolean {
    const expected = this.checksums.get(key);
    if (!expected) return false;
    const actual = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    return actual === expected;
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.checksums);
  }

  static fromJSON(data: Record<string, string>): ChecksumStore {
    const store = new ChecksumStore();
    for (const [key, value] of Object.entries(data)) {
      store.set(key, value);
    }
    return store;
  }

  // ── L2 SHA-256 Attestation ──

  /**
   * Attest a plan by computing its SHA-256 hash and locking it.
   *
   * The hash is cached both in memory and on disk so that subsequent
   * sessions can verify plan integrity across reboots.
   *
   * @param content  The plan content to attest.
   * @returns The computed SHA-256 hash.
   */
  async attestPlan(content: string): Promise<string> {
    const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    this.attestedHash = hash;
    this.attestedAt = new Date().toISOString();
    await this.persistAttestation();
    return hash;
  }

  /**
   * Verify that the supplied content matches the locked attestation.
   *
   * On failure the result includes both the `expected` (attested) hash and
   * the `actual` hash so callers can diagnose the drift.
   *
   * @param content  The content to verify.
   * @returns `{ verified: true }` on match, otherwise
   *          `{ verified: false, expected, actual }`.
   */
  async verifyAttestation(content: string): Promise<AttestationResult> {
    if (this.attestedHash === null) {
      await this.loadAttestation();
    }
    if (this.attestedHash === null) {
      return { verified: false };
    }
    const actual = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    if (actual === this.attestedHash) {
      return { verified: true };
    }
    return { verified: false, expected: this.attestedHash, actual };
  }

  /**
   * Return the currently locked attestation hash, or `null` if nothing
   * has been attested.
   */
  showAttestation(): string | null {
    return this.attestedHash;
  }

  /**
   * Clear the locked attestation hash from both memory and disk.
   */
  async clearAttestation(): Promise<void> {
    this.attestedHash = null;
    this.attestedAt = null;
    await this.removeAttestationFile();
  }

  // ── private helpers ──

  /**
   * Persist the current attestation record to the cache directory.
   */
  private async persistAttestation(): Promise<void> {
    if (this.attestedHash === null || this.attestedAt === null) return;
    await fs.mkdir(this.cacheDir, { recursive: true });
    const record: AttestationRecord = {
      hash: this.attestedHash,
      attested_at: this.attestedAt,
    };
    await fs.writeFile(this.getAttestationPath(), JSON.stringify(record, null, 2), 'utf8');
  }

  /**
   * Load the attestation record from disk into memory, if one exists.
   */
  private async loadAttestation(): Promise<void> {
    try {
      const raw = await fs.readFile(this.getAttestationPath(), 'utf8');
      const record = JSON.parse(raw) as AttestationRecord;
      if (record && typeof record.hash === 'string') {
        this.attestedHash = record.hash;
        this.attestedAt = record.attested_at ?? null;
      }
    } catch {
      // No persisted attestation yet — leave in-memory state as-is.
    }
  }

  /**
   * Remove the persisted attestation file, ignoring missing-file errors.
   */
  private async removeAttestationFile(): Promise<void> {
    try {
      await fs.unlink(this.getAttestationPath());
    } catch {
      // File does not exist — nothing to remove.
    }
  }

  private getAttestationPath(): string {
    return path.join(this.cacheDir, ATTESTATION_FILE);
  }
}
