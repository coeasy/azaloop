#!/usr/bin/env node
// Post-install script — shows welcome message after global install
// Users can run: aza init  to configure their project

const msg = `
  ╔══════════════════════════════════════════╗
  ║           AzaLoop  v12.2                 ║
  ║  PRD-Driven Autonomous Development Loop  ║
  ╚══════════════════════════════════════════╝

  Getting Started:
  ────────────────
  $ cd your-project
  $ aza init

  This will auto-detect your AI coding assistant
  and configure everything in < 1 second.

  Documentation:
  ──────────────
  Per-client guides:  docs/clients/
  Full installation:  docs/CLIENT-INSTALLATION.md
  
  Happy coding with AI! 🚀
`;

// Don't print during npm install (too noisy), but make available
export const WELCOME_MESSAGE = msg;
