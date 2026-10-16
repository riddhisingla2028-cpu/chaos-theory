# Chaos Theory

A neon arcade survival game for the browser where the rules keep breaking.

You steer a small shape around an arena while hazards close in. Every few seconds a **chaos event** rewrites the rules: your controls flip, the walls close in, gravity drags you sideways. Survive, collect orbs, and work through ten levels to a final boss fight. It plays on desktop and phone, with no install and no account.

## Game modes

| Mode | What it is |
|---|---|
| **Levels** | A 10-level campaign. Each level has its own objective, mechanic, colour and difficulty, and clearing one unlocks the next. |
| **Endless** | Survive as long as you can. New rules join the longer you last. |
| **Daily** | One seeded run per day with a daily twist (for example *Overclock* or *Swarm*), the same for every player. |
| **Trials** | Two bonus challenges (*Orb Frenzy*, *Boss Rush*), part of the demo Chaos+ tier. |

### The 10 levels

| # | Level | Objective | Signature mechanic |
|---|---|---|---|
| 1 | Beginner | Survive 5s | Slow hazards, learn to move |
| 2 | Speed Rush | Survive 8s | Much faster hazards |
| 3 | Orb Hunt | Collect 3 orbs | Collectible orbs |
| 4 | Reverse Control | Survive 8s | Controls flip at random, with a warning |
| 5 | The Vanishing Zone | Survive 10s | Floor tiles vanish after flashing a warning |
| 6 | Double Chaos | Collect 5 orbs | Two chaos rules active at once |
| 7 | Glitch Attack | Survive 10s | Screen distortion; hazards swerve and teleport (a ghost marks where) |
| 8 | Shrinking Arena | Survive 12s | The walls close in continuously |
| 9 | Chaos Combo | Collect 7 orbs in 15s | Random combinations of earlier rules |
| 10 | Final Showdown | Defeat the Core | Boss fight: bursts, sweeping beams and summoned waves; collect 5 orbs to break it |

Locked levels show a short live preview with their objective, difficulty and an "Unlock by playing" progress bar. Each level awards 1–3 stars: one for clearing, two and three for high scores built with near misses, orbs and combos.

### Chaos events

Inversion, Collapse, Afterimage, Gravity Shift, Surge, Scanline, Phantom, Event Horizon and Glitch. Every event is announced with a warning banner before it starts, and hazards slow down briefly when a rule changes so players can adapt.

## Features

- **Fair, gradual difficulty:** every run starts with a slow warm-up, difficulty ramps in smoothly, and Endless introduces one rule at a time.
- **Scoring:** points for survival time, near-miss combos up to ×5, orb bonuses and milestone rewards.
- **Instant retry:** a large one-tap Retry button, plus a comparison with your last attempt and how close you came to the objective.
- **Progression:** stars, 15 achievements, unlockable player skins and colour themes, a records screen with lifetime stats and a top-10 for each mode.
- **Polish:** an animated neon lobby, particles, screen shake, a victory celebration, and sound effects and menu music generated in code with the Web Audio API (no audio files).
- **Mobile:** a phone-first layout that also adapts to landscape, a floating or fixed touch joystick (configurable), and protection against scrolling, zooming and accidental refresh during play.
- **Accessibility:** keyboard play throughout, visible focus states, and reduced motion when the device asks for it.
- **Saved locally:** all progress and settings are stored in the browser (`localStorage`), and the game still works if storage is blocked.

### Chaos+ (demo only)

Chaos+ is an optional *demonstration* of a premium tier: two exclusive skins, two neon themes, two bonus trials and level skips (offered only after three failed attempts). **No real payments are taken.** The checkout is clearly labelled as a demo, collects no payment details, and unlocks the content locally. Real payments would need a server to verify each purchase, which is not part of this project. The whole campaign can be completed for free, and Chaos+ never changes difficulty or scores.

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
  progress.ts         Stars, achievements, unlocks, records, settings and saving
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
npm test           # 100 unit tests
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

The unit tests cover:

- scoring, combos and milestones
- the warm-up and difficulty ramp
- every chaos event, including paired events
- orbs, time limits, vanishing tiles, shrinking walls, teleporting hazards and the boss's attacks and defeat
- that every level and trial can be won (played by the autopilot)
- star thresholds, skips, the demo entitlement, records, saved-data migration, and keyboard and touch input

Level difficulty was balanced by simulating hundreds of runs per level with the autopilot set to beginner and attentive skill levels.
