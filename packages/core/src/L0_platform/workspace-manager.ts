import * as fs from 'fs/promises';
import * as path from 'path';

export interface WorkspaceInfo {
  root: string;
  projects: string[];
  activeProject?: string;
}

export class WorkspaceManager {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  async detectProjects(): Promise<string[]> {
    const projects: string[] = [];
    try {
      const entries = await fs.readdir(this.root);
      for (const entry of entries) {
        const fullPath = path.join(this.root, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          try {
            await fs.access(path.join(fullPath, 'package.json'));
            projects.push(entry);
          } catch {
            // Not a node project
          }
        }
      }
    } catch {
      // Root not accessible
    }
    return projects;
  }

  getInfo(): WorkspaceInfo {
    return {
      root: this.root,
      projects: [], // Populated after detectProjects()
    };
  }

  async ensureAzaDir(): Promise<string> {
    const azaDir = path.join(this.root, '.aza');
    await fs.mkdir(azaDir, { recursive: true });
    return azaDir;
  }

  isAzaLoopProject(): boolean {
    try {
      const fs = require('fs');
      return fs.existsSync(path.join(this.root, '.aza'));
    } catch {
      return false;
    }
  }
}
