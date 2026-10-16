# Chaos Theory

A neon arcade survival game for the browser where the rules keep breaking.

You steer a small shape around an arena while hazards close in. Every few seconds a **chaos event** rewrites the rules: your controls flip, the walls close in, gravity drags you sideways. Survive, collect orbs, and work through ten levels to a final boss fight. It plays on desktop and phone, with no install and no account.

## Game modes

| Mode | What it is |
|---|---|
| **Levels** | A 10-level campaign. Each level has four escalating phases, its own objective, mechanic, colour and difficulty, and clearing one unlocks the next. |
| **Endless Modes** | Four always-unlocked modes: **Classic Survival**, **Orb Rush**, **Chaos Survival** and **Boss Rush**, each with its own personal bests. |
| **Daily** | One seeded run per day with a daily twist (for example *Overclock* or *Swarm*), the same for every player. |
| **Trials** | Two bonus challenges (*Orb Frenzy*, *Hard Core*), available through the free Chaos+ cosmetics preview. |

### The 10 levels

Every level runs through four phases (introduce the mechanic, raise the pressure, a harder variation, then a final mastery test), announced on screen as each begins.

| # | Level | Objective | Phases |
|---|---|---|---|
| 1 | Beginner | Survive 15s | Learn to move → Hazards arrive → Crossfire → Final test (slip through a wall) |
| 2 | Speed Rush | Survive 24s | Three speed waves → Final sprint |
| 3 | Orb Hunt | Collect 10 orbs | Gather → Further out → Hunted (seekers, gold orbs) → Last orb under rain |
| 4 | Reverse Control | Survive 24s | Normal → Reversed → Weavers (normal controls) → Flip storm |
| 5 | The Vanishing Zone | Survive 28s | The floor vanishes in more and more tiles, always with a warning |
| 6 | Double Chaos | Collect 12 orbs | One rule → Rules in pairs → Overload → Last orb |
| 7 | Glitch Attack | Survive 28s | Swerves → Teleports (ghost warnings) → Signal storm → Blackout |
| 8 | Shrinking Arena | Survive 30s | The walls close in step by step while hazards increase |
| 9 | Chaos Combo | Collect 15 orbs in 50s | Mixed rules → Combos → Everything (vanishing floor too) → Finale |
| 10 | Final Showdown | Defeat the Core (10 hits) | Awakening → Enraged (beams) → Shockwave → Desperation (twin beams); visible health bar, shielded phase changes |

### Endless Modes

| Mode | Objective | Personal bests |
|---|---|---|
| Classic Survival | Survive as long as possible; new rules join at milestones | Time, score |
| Orb Rush | Collect as many orbs as possible; gold orbs are worth triple but expire | Orbs, score |
| Chaos Survival | A constant stream of announced, randomly chosen chaos events that pair up over time | Score, events survived |
| Boss Rush | Defeat Core after Core; each has more health and new attacks | Boss streak, score |

Locked levels show a short live preview with their objective, difficulty and an "Unlock by playing" progress bar. Each level awards 1–3 stars: one for clearing, two and three for high scores built with near misses, orbs and combos.

### Chaos events

Inversion, Collapse, Afterimage, Gravity Shift, Surge, Scanline, Phantom, Event Horizon and Glitch. Every event is announced with a warning banner before it starts, and hazards slow down briefly when a rule changes so players can adapt.

## Features

- **Fair, gradual difficulty:** every run starts with a slow warm-up, difficulty ramps in smoothly, and Endless introduces one rule at a time.
- **Scoring:** points for survival time, near-miss combos up to ×5, orb bonuses and milestone rewards.
- **Instant retry:** a large one-tap Retry button, plus a comparison with your last attempt and how close you came to the objective.
- **Progression:** stars, 19 achievements, unlockable player skins and colour themes, a records screen with lifetime stats and a top-10 for each mode, and per-mode personal bests that never go down.
- **Polish:** an animated neon lobby, phase announcements, a boss health bar, particles, screen shake, a completion celebration, and sound effects and menu music generated in code with the Web Audio API (no audio files).
- **Mobile sound:** audio starts on the first tap (as iOS and Android require), recovers after the app is backgrounded, and shows a "Tap to enable sound" control if the browser is still blocking it. The mute preference is saved.
- **Mobile:** a phone-first layout that also adapts to landscape, a floating or fixed touch joystick (configurable), and protection against scrolling, zooming and accidental refresh during play.
- **Accessibility:** keyboard play throughout, visible focus states, and reduced motion when the device asks for it.
- **Saved locally:** all progress and settings are stored in the browser (`localStorage`), and the game still works if storage is blocked.

### Chaos+ Ad-Free (coming soon)

Chaos+ Ad-Free is a planned optional upgrade that removes ads and adds cosmetics, with no gameplay advantage. **Purchasing is not available yet:** the button shows "Coming soon", and no payment can be made. A free, clearly labelled *cosmetics preview* lets players try the premium skins, themes and trials; it is not a purchase and does not remove ads. Players stuck on a level for three attempts can skip it for free (a skipped level gives no stars).

### Advertising (disabled)

The game has reserved, provider-agnostic ad slots on the home screen, level select and every results screen. There are never ads during gameplay or over the arena. **Ads are disabled:** no ad network, no third-party scripts and no tracking are included. Production builds render no ad slots at all; development builds show clearly marked placeholders.

To enable ads in future, after choosing and approving a provider:
1. Implement the `AdProvider` interface in `src/monetization/ads.ts` and set `AD_PROVIDER`.
2. Build with `VITE_ADS_ENABLED=true`.

Ad-free status comes only from `src/monetization/entitlements.ts`, which trusts nothing but a server-verified purchase (`PURCHASE_VERIFIER`, not yet configured). Between-run ads are frequency-capped, and rewarded ads stay off until a real provider exists.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | `WASD` / arrow keys | Drag anywhere (floating joystick), or use the fixed joystick |
| Start / continue | `Enter` / `Space` | Tap the button |
| Retry after a run | `R` / `Enter` | Tap **Retry** |
| Pause / resume | `P` / `Esc` | Tap the pause button |
| Mute | `M` | Tap the speaker icon |
| Back (menus) | `Esc` | Tap **Back** |

## Tech stack

React 18, TypeScript and Vite, with the game drawn on an HTML Canvas. There is no backend, no accounts, no paid APIs, and no environment variables or secrets. The only external resource is the Google Fonts stylesheet (Unbounded and Inter), with system-font fallbacks.

```
src/
  game/engine.ts      Pure, deterministic simulation: movement, hazards, chaos events, orbs, voids, boss, objectives
  game/stages.ts      The 10 levels, trials and daily challenge definitions
  game/render.ts      Canvas rendering for the arena and every mechanic
  game/autopilot.ts   AI pilot used for the live level previews and balance testing
  game/fx.ts          Particles, popups, screen shake
  game/audio.ts       Synthesised sound effects and ambient music
  game/input.ts       Keyboard and touch-joystick input
  progress.ts         Stars, achievements, unlocks, records, per-mode bests, settings and versioned saving
  monetization/       Ad slots, frequency caps and the entitlement service (ads disabled, no provider)
  ui/                 Lobby, level map, previews, results, collection, settings
  App.tsx             Screen flow, HUD, game loop, touch controls
```

## Run locally

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev                    # http://localhost:5173
npm run dev -- --host 0.0.0.0  # also reachable from a phone on the same Wi-Fi
```

## Test and build

```bash
npm test           # 149 unit tests
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

The unit tests cover:

- scoring, combos and milestones
- the warm-up and difficulty ramp
- every chaos event, including paired events
- orbs, time limits, vanishing tiles, shrinking walls, teleporting hazards and the boss's attacks and defeat
- that every level and trial can be won (played by the autopilot)
- level phases, the boss's phases and attacks, all four Endless modes (including that each is genuinely playable)
- audio unlocking, suspension recovery, mute and music (using a simulated AudioContext)
- ad slot decisions, the entitlement service (a local flag can never grant ad-free status), frequency caps and the ad component
- star thresholds, skips, records, per-mode bests, saved-data migration, and keyboard and touch input

Level difficulty was balanced by simulating hundreds of runs per level with the autopilot set to beginner and attentive skill levels.
