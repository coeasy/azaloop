# Workers matrix

> Default analysis workers from `buildDefaultRegistry()` — not on the critical `next_action` spine.

| Worker | Typical trigger | Artifact / effect | Default on spine? |
|--------|-----------------|-------------------|-------------------|
| ultralearn | explore / preload | knowledge notes | No — on-demand |
| optimize | post-verify | refactor hints | No |
| predict | planning | risk forecast | No |
| audit | verify | audit findings | Prefer `aza_quality` |
| map | design | dependency map | No |
| deepdive | blocked story | deep analysis | No |
| document | archive | docs | Prefer `aza_finish` |
| refactor | debt signal | patch plan | No |
| benchmark | perf | bench report | No |
| testgaps | verify | missing tests | Yes — useful in verify |
| preload | session start | context warm | Session path |
| consolidate | memory pressure | compressed mem | L2 memory |
| scheduler | batch | schedules work | `aza_loop batch` |

Spine path remains: `aza_auto` / `aza_prd` → `aza_loop` → `aza_spec` / `aza_quality` → `aza_finish`.
