/**
 * Federation stub (P3-4) — multi-machine agent collaboration via shared git/.aza.
 * Full SSH remoting is future work; this provides the local sync contract.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FederationPeer {
  id: string;
  label: string;
  shared_aza: string;
  last_seen?: string;
}

export interface FederationManifest {
  version: '0.1';
  project_root: string;
  peers: FederationPeer[];
  updated_at: string;
}

export function federationPath(projectRoot: string): string {
  return path.join(projectRoot, '.aza', 'federation.json');
}

export function loadFederation(projectRoot: string): FederationManifest {
  const p = federationPath(projectRoot);
  if (!fs.existsSync(p)) {
    return {
      version: '0.1',
      project_root: projectRoot,
      peers: [],
      updated_at: new Date().toISOString(),
    };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as FederationManifest;
}

export function registerFederationPeer(
  projectRoot: string,
  peer: Omit<FederationPeer, 'last_seen'>,
): FederationManifest {
  const m = loadFederation(projectRoot);
  const existing = m.peers.findIndex((x) => x.id === peer.id);
  const entry: FederationPeer = { ...peer, last_seen: new Date().toISOString() };
  if (existing >= 0) m.peers[existing] = entry;
  else m.peers.push(entry);
  m.updated_at = new Date().toISOString();
  const aza = path.join(projectRoot, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  fs.writeFileSync(federationPath(projectRoot), JSON.stringify(m, null, 2), 'utf8');
  return m;
}

/** Sync marker — copies RESUME/STATE digest into peer shared folder when present. */
export function syncFederationDigest(projectRoot: string, peerId: string): { ok: boolean; detail: string } {
  const m = loadFederation(projectRoot);
  const peer = m.peers.find((p) => p.id === peerId);
  if (!peer) return { ok: false, detail: `peer ${peerId} not registered` };
  try {
    fs.mkdirSync(peer.shared_aza, { recursive: true });
    for (const f of ['RESUME.md', 'STATE.yaml', 'plan.md']) {
      const src = path.join(projectRoot, '.aza', f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(peer.shared_aza, f));
      }
    }
    peer.last_seen = new Date().toISOString();
    fs.writeFileSync(federationPath(projectRoot), JSON.stringify(m, null, 2), 'utf8');
    return { ok: true, detail: `Synced digest to ${peer.shared_aza}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message || String(e) };
  }
}
