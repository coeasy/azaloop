/**
 * Presets ecosystem (P2-6 / spec-kit inspired).
 * Load workflow presets from `.aza/presets/*.yaml` or built-in pack.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AzaPreset {
  id: string;
  name: string;
  description: string;
  mode?: 'full' | 'oneshot';
  loop?: {
    max_iterations?: number;
    outer_enabled?: boolean;
    parallel?: boolean;
    token_budget?: number;
  };
  prd?: {
    auto_approve?: boolean;
    enable_competitive_research?: boolean;
    multi_role_review?: boolean;
  };
  quality?: {
    ui_qa?: boolean;
    require_sdd?: boolean;
  };
  source: 'builtin' | 'project';
  path?: string;
}

const BUILTIN: AzaPreset[] = [
  {
    id: 'full-auto',
    name: 'Full Auto Loop',
    description: 'PRD → design → build → verify → archive with auto-approve when env set',
    mode: 'full',
    loop: { max_iterations: 50, outer_enabled: true, parallel: false, token_budget: 4000 },
    prd: { auto_approve: false, enable_competitive_research: true, multi_role_review: true },
    quality: { ui_qa: false, require_sdd: true },
    source: 'builtin',
  },
  {
    id: 'oneshot',
    name: 'Oneshot Task',
    description: 'Single-step task without multi-story outer board (PLANNING_DISABLED)',
    mode: 'oneshot',
    loop: { max_iterations: 5, outer_enabled: false, parallel: false, token_budget: 2000 },
    prd: { auto_approve: true, enable_competitive_research: true, multi_role_review: false },
    quality: { ui_qa: false, require_sdd: false },
    source: 'builtin',
  },
  {
    id: 'strict-verify',
    name: 'Strict Verify',
    description: 'Full loop with SDD dual review + optional UI QA markers',
    mode: 'full',
    loop: { max_iterations: 40, outer_enabled: true, parallel: true, token_budget: 3500 },
    prd: { auto_approve: false, enable_competitive_research: true, multi_role_review: true },
    quality: { ui_qa: true, require_sdd: true },
    source: 'builtin',
  },
];

function parseSimplePresetYaml(text: string, id: string, filePath: string): AzaPreset {
  const get = (key: string, def = '') => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m?.[1]?.trim().replace(/^["']|["']$/g, '') || def;
  };
  const getBool = (key: string, def = false) => {
    const v = get(key, String(def)).toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  };
  const getNum = (key: string, def: number) => {
    const n = Number(get(key, String(def)));
    return Number.isFinite(n) ? n : def;
  };
  return {
    id: get('id', id),
    name: get('name', id),
    description: get('description', ''),
    mode: (get('mode', 'full') as 'full' | 'oneshot') || 'full',
    loop: {
      max_iterations: getNum('max_iterations', 50),
      outer_enabled: getBool('outer_enabled', true),
      parallel: getBool('parallel', false),
      token_budget: getNum('token_budget', 4000),
    },
    prd: {
      auto_approve: getBool('auto_approve', false),
      enable_competitive_research: getBool('enable_competitive_research', true),
      multi_role_review: getBool('multi_role_review', true),
    },
    quality: {
      ui_qa: getBool('ui_qa', false),
      require_sdd: getBool('require_sdd', true),
    },
    source: 'project',
    path: filePath,
  };
}

/** List builtin + project presets under `<root>/.aza/presets/`. */
export function listPresets(projectRoot: string): AzaPreset[] {
  const out = [...BUILTIN];
  const dir = path.join(projectRoot, '.aza', 'presets');
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.ya?ml$/i.test(f)) continue;
    const fp = path.join(dir, f);
    try {
      const text = fs.readFileSync(fp, 'utf8');
      const id = path.basename(f, path.extname(f));
      out.push(parseSimplePresetYaml(text, id, fp));
    } catch {
      /* skip bad files */
    }
  }
  return out;
}

export function getPreset(projectRoot: string, id: string): AzaPreset | null {
  return listPresets(projectRoot).find((p) => p.id === id) || null;
}

/** Apply preset to process env + write `.aza/active-preset.json`. */
export function applyPreset(projectRoot: string, id: string): AzaPreset {
  const preset = getPreset(projectRoot, id);
  if (!preset) throw new Error(`Preset not found: ${id}`);

  if (preset.mode === 'oneshot') {
    process.env.AZALOOP_MODE = 'oneshot';
    process.env.PLANNING_DISABLED = 'true';
  } else {
    delete process.env.AZALOOP_MODE;
    delete process.env.PLANNING_DISABLED;
  }
  if (preset.loop?.parallel) process.env.AZA_OUTER_PARALLEL = 'true';
  if (preset.loop?.outer_enabled === false) process.env.AZA_OUTER_LOOP = 'false';
  if (preset.prd?.auto_approve) process.env.AZA_AUTO_APPROVE_PRD = 'true';
  if (preset.quality?.ui_qa) process.env.AZA_UI_QA = 'true';

  const aza = path.join(projectRoot, '.aza');
  fs.mkdirSync(aza, { recursive: true });
  fs.writeFileSync(path.join(aza, 'active-preset.json'), JSON.stringify(preset, null, 2), 'utf8');

  // Seed project presets folder with builtins if empty
  const presetsDir = path.join(aza, 'presets');
  if (!fs.existsSync(presetsDir)) {
    fs.mkdirSync(presetsDir, { recursive: true });
    for (const b of BUILTIN) {
      const yaml = [
        `id: ${b.id}`,
        `name: "${b.name}"`,
        `description: "${b.description}"`,
        `mode: ${b.mode}`,
        `max_iterations: ${b.loop?.max_iterations ?? 50}`,
        `outer_enabled: ${b.loop?.outer_enabled ?? true}`,
        `parallel: ${b.loop?.parallel ?? false}`,
        `token_budget: ${b.loop?.token_budget ?? 4000}`,
        `auto_approve: ${b.prd?.auto_approve ?? false}`,
        `enable_competitive_research: ${b.prd?.enable_competitive_research ?? true}`,
        `multi_role_review: ${b.prd?.multi_role_review ?? true}`,
        `ui_qa: ${b.quality?.ui_qa ?? false}`,
        `require_sdd: ${b.quality?.require_sdd ?? true}`,
        '',
      ].join('\n');
      fs.writeFileSync(path.join(presetsDir, `${b.id}.yaml`), yaml, 'utf8');
    }
  }
  return preset;
}
