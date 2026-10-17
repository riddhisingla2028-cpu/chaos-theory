# Chaos Theory

A neon arcade survival game for the browser where the rules keep breaking.

You steer a small shape through ten different arenas while hazards close in. Every few seconds a **chaos event** rewrites the rules: your controls flip, the floor falls away, gravity drags you sideways. Survive, collect orbs, and fight your way to a boss whose arena changes as it breaks. Play solo or with up to five friends in private multiplayer rooms. It runs in the browser on desktop and phone, with no install, and no account needed to start.

## Game modes

| Mode | What it is |
|---|---|
| **Levels** | A 10-level campaign. Each level has four escalating phases, its own objective, mechanic, colour and difficulty, and clearing one unlocks the next. |
| **Endless Modes** | Four always-unlocked modes: **Classic Survival**, **Orb Rush**, **Chaos Survival** and **Boss Rush**, each with its own personal bests. |
| **Daily** | One seeded run per day with a daily twist (for example *Overclock* or *Swarm*), the same for every player. |
| **Multiplayer** | Private rooms for 2–6 players with a room code or invite link: **Co-op Survival**, **Last Player Standing** and **Orb Race**. |
| **Trials** | Two bonus challenges (*Orb Frenzy*, *Hard Core*), available through the free Chaos+ cosmetics preview. |

### The 10 levels

Every level has its own arena geometry (walls, floors that come and go, rotors) defined in `src/game/arenas.ts`, plus four escalating phases announced on screen.

| # | Level | Arena | Objective | What makes it different |
|---|---|---|---|---|
| 1 | Beginner | **The Grid**: a clean training square | Survive 15s | Learn to move, then crossfire and a wall with one gap |
| 2 | Speed Rush | **Collapse**: the outer tiles fall away one by one (2s warning each) | Survive 24s | Speed waves while the safe area shrinks to the centre |
| 3 | Orb Hunt | **The Maze**: corridors and dead ends | Collect 10 orbs | Route through walls while seekers hunt you |
| 4 | Reverse Control | **The Ring**: a circular arena with a two-arm rotor sweeping round a central pillar | Survive 24s | Flipped controls while dodging the rotor |
| 5 | The Vanishing Zone | **Split Decision**: two platforms over a chasm, joined by timed drawbridges; each side floods in turn | Survive 28s | Cross before your side goes |
| 6 | Double Chaos | **The Spiral**: a winding spiral corridor | Collect 12 orbs | Paired chaos rules in a space that forces you to keep moving |
| 7 | Glitch Attack | **The Gauntlet**: a long, narrow corridor | Survive 28s | Teleporting, glitching hazards with nowhere wide to run |
| 8 | Shrinking Arena | **Fracture**: an asymmetric shattered floor with sliding walls; whole sections fall away (3s warning) | Survive 30s | Retreat to the heart as the floor breaks |
| 9 | Chaos Combo | **The Void**: islands joined by bridges that come and go | Collect 10 orbs in 50s | Each island has two routes on alternating rhythms; pick the one that holds |
| 10 | Final Showdown | **The Core**: a circular boss arena that changes each phase (pillars, tighter ring, then a rotor) | Defeat the Core (10 hits) | Bursts, beams, shockwaves and twin beams; shielded phase changes |

Falling off a floor edge or being swept by a rotor ends the run, with its own message on the results screen. Floors and rotors always show a warning (striped edges, a dashed rotor outline) before they change.
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

- **Ten arenas, ten identities:** each level has its own geometry, colour, mechanic and four escalating phases (see the table above). Floors warn before they fall, rotors show a dashed outline before they arm, and every phase is announced.
- **Balanced by simulation:** an autopilot plays hundreds of runs per level at two skill profiles; later levels clear far less often than early ones, and arena tests prove a moving player can never be stranded by the geometry.
- **Progression:** XP from every run, account levels (up to 50), three daily and three weekly challenges, 19 achievements, stars, per-level records (best score, fastest clear, attempts, deaths), match history, and a rewards panel on every results screen that itemises the XP earned.
- **Cosmetics, all earned by playing:** skins and colour themes, plus trails (Classic, Comet, Beads, Prism) and victory effects (Confetti, Shockwave, Fireworks, Starfall) unlocked by account level. None of them changes gameplay.
- **Profile:** account level and XP, challenges, campaign records and the last 25 matches.
- **Social:** a local leaderboard (top 10 per mode plus "This week"), clearly labelled as this device only, and a **Share score** button that makes a score-card image (system share sheet on phones, saved as a PNG elsewhere).
- **Polish:** an animated neon launcher, phase announcements, a boss health bar, particles, screen shake, celebrations, and sound and music generated in code with the Web Audio API.
- **Audio:** separate sound-effect and music volumes plus a master mute. Audio starts on the first tap (as iOS and Android require), recovers when the tab returns, never runs two music loops, and volume is capped so it can never jump above the default level.
- **Accessibility:** full keyboard play, visible focus states, a reduced-motion setting (follows the device by default), a high-contrast setting, 44px touch targets, and warnings that use shape and pattern as well as colour.
- **Mobile:** a phone-first layout that adapts to landscape, floating or fixed touch joystick, and protection against scrolling, zooming and accidental refresh during play.
- **Saving:** progress is saved in the browser for guests, with safe migration of older saves. Optional accounts sync it to the cloud (see below).

## Accounts and cloud saves (optional, needs Supabase)

Players can always play as guests; nobody has to sign up first. When the build is configured with a Supabase project, the Profile screen offers **sign up with email, email verification, sign in, sign out and password reset**, and progress (levels, stars, records, achievements, XP, challenges, history) syncs across devices.

- **Guest to account:** on first sign-in, the guest progress on that device is merged into the account. Nothing is overwritten: every record keeps the better of the two values, and repeating a sync changes nothing, so an older device can never erase newer progress.
- **Security:** only the public anon key is used in the browser. Row-level security lets each player read and write only their own save, and a database trigger validates saves (shape, size, value ranges) and strips anything purchase-related. Settings stay per device.
- **Not configured (the current state):** the Profile screen says that accounts and cloud saves are not set up yet and shows no sign-in buttons. The Supabase library is not even downloaded.

**To enable:** create a free Supabase project, run `supabase/schema.sql` in its SQL editor, set *Authentication → URL configuration* to your site URL, then build with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`). Never put the service-role key in the frontend. The account flow is unit-tested and browser-tested against a simulated Supabase; it has not yet been tested against a real Supabase project.

## Multiplayer

Real-time, private rooms over WebRTC. One player creates a room and gets a 5-character code and an invite link (`?room=CODE`); friends join with either. Players have names and their chosen shape as an avatar, ready up in a lobby, and the host chooses the mode and starts the match. Live scores show during play; results, rematches and mode changes follow.

| Mode | Rules |
|---|---|
| Co-op Survival | Survive two minutes together in The Grid. Downed players return after 5s while anyone is still standing. |
| Last Player Standing | One hit and you are out, in The Ring with its sweeping rotor. Last one standing wins. |
| Orb Race | Most orbs in 60 seconds in The Maze wins. A hit costs an orb and a moment. |

**Boss Co-op is not available yet.**

**How it works:** the host's browser runs the only simulation. Other players send just their stick input (clamped and rate-limited by the host) and receive state snapshots 20 times a second, which they smooth for display. No client can set positions, scores or results. Connections are peer-to-peer (WebRTC via PeerJS); the free public PeerJS service only introduces the browsers to each other, so no server, key or account is needed. Dropped players reconnect into the same seat, players who leave free their place, and if the host leaves, everyone is told the room has closed.

**Limits:** the host's game is trusted, so this suits private games between friends, not ranked or public matchmaking. That would need a dedicated authoritative game server (for example a small Node WebSocket service), which also removes the peer-to-peer address sharing. Some strict corporate or mobile networks block peer-to-peer connections; a TURN relay service would be needed to reach those players. Multiplayer does not award XP.

### Chaos+ (optional supporter purchase)

Chaos+ is an optional one-time purchase sold through Gumroad. It adds a supporter badge, the Halo trail and Supernova victory effect (which cannot be earned by playing), the Chaos+ collection (two skins, two themes) and two bonus trials. It never affects gameplay; every level, mode and multiplayer room is free.

**Purchase verification:** Gumroad emails the buyer a license key. The game sends it to `/api/verify-license` (a Cloudflare Pages Function in `functions/`, logic in `server/license.ts`), which checks it with Gumroad. Only a valid, unrefunded, non-charged-back purchase unlocks Chaos+, and the key is re-checked on every visit. Nothing in the browser can grant Chaos+ on its own, and no secret key exists.

**Until it is configured** (see `.env.example` and `LAUNCH.md`), the page shows "Coming soon", no price, and a clearly labelled free preview of the collection. Players stuck on a level for three attempts can skip it for free (no stars).

### Advertising (placeholders only)

Five menu screens show a labelled placeholder panel ("Your brand here · Advertise with Chaos Theory"): the **launcher** (below the modes), **level select**, **level results**, **Endless results** and the **profile page**. There is **no ad on the game screen**: nothing during gameplay, over the arena or over controls. The placeholders are part of the game itself: there is no ad network, no third-party script, no tracking, and no advertisers or sponsors. Chaos+ supporters do not see them.

- Switch a single placement off in `AD_PLACEMENTS` (`src/monetization/ads.ts`), or all of them with `VITE_AD_PLACEHOLDERS=false`.
- An "Advertise with us" link appears on the placeholders only when `VITE_ADVERTISE_EMAIL` is set.
- To run real ads later, after choosing and approving a provider: implement the `AdProvider` interface in `src/monetization/ads.ts`, set `AD_PROVIDER`, and build with `VITE_ADS_ENABLED=true`. Between-run ads are frequency-capped, and rewarded ads stay off until a real provider exists.

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

React 18, TypeScript and Vite, with the game drawn on an HTML Canvas. No environment variables are required, and none are secret. External resources: the Google Fonts stylesheet (with system-font fallbacks); the public PeerJS broker, only once someone opens Multiplayer; and Supabase, only if it is configured.

```
src/
  game/engine.ts      Pure, deterministic simulation: movement, hazards, chaos events, orbs, voids, boss, objectives
  game/arenas.ts      Arena geometry: walls, timed floors, rotors, collision and fall checks
  game/stages.ts      The 10 levels, trials and daily challenge definitions
  game/render.ts      Canvas rendering for the arena and every mechanic
  game/autopilot.ts   AI pilot used for the live level previews and balance testing
  game/fx.ts          Particles, popups, screen shake
  game/audio.ts       Synthesised sound effects and ambient music
  game/input.ts       Keyboard and touch-joystick input
  progress.ts         Stars, achievements, unlocks, records, per-mode bests, settings and versioned saving
  progression.ts      XP, account levels, daily and weekly challenges, match history, trails and victory effects
  cloud/              Supabase accounts and cloud sync (off unless configured) and the save merge
  net/                Multiplayer: match simulation, rooms and protocol, PeerJS transport
  monetization/       Ad slots, frequency caps and the entitlement service (ads disabled, no provider)
  ui/                 Lobby, level map, previews, results, collection, settings
  App.tsx             Screen flow, HUD, game loop, touch controls
```

## Launching

See [LAUNCH.md](LAUNCH.md) for the feature audit, the payment and hosting decision, step-by-step setup (Gumroad, Cloudflare Pages, domain, analytics), the launch plan and the submission checklist.

## Run locally

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev                    # http://localhost:5173
npm run dev -- --host 0.0.0.0  # also reachable from a phone on the same Wi-Fi
```

## Test and build

```bash
npm test           # 204 unit tests
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

The unit tests cover:

- scoring, combos and milestones
- the warm-up and difficulty ramp
- every chaos event, including paired events
- orbs, time limits, vanishing tiles, shrinking walls, teleporting hazards and the boss's attacks and defeat
- that every level and trial can be won (played by the autopilot)
- arena geometry: safe spawns, always enough room to stand, a player who keeps moving can never be stranded, and every Void island always has a bridge
- level phases, the boss's phases and attacks, all four Endless modes (including that each is genuinely playable)
- audio unlocking, suspension recovery, mute, music, and separate sound and music volumes (using a simulated AudioContext)
- XP, account levels, daily and weekly challenges (rotation, accumulation, completed once), match history and level-gated cosmetics
- save merging for cloud sync (keeps the best of both, safe to repeat, never takes settings or purchase flags from the cloud), and the account flows against a simulated Supabase
- multiplayer: the match simulation (deterministic, input clamping, each mode's win rules, disconnects), room codes and name cleaning, and the room protocol over an in-memory network (lobby, ready, start, live snapshots, results, rematch, reconnect into the same seat, host leaving, full rooms, a client unable to move others or fake results)
- ad slot decisions, the entitlement service (a local flag can never grant ad-free status), frequency caps and the ad component
- star thresholds, skips, records, per-mode bests, saved-data migration, and keyboard and touch input

Level difficulty was balanced by simulating hundreds of runs per level with the autopilot set to beginner and attentive skill levels.

Multiplayer was also tested end to end with two separate Chrome browsers (one desktop-sized, one phone-sized with touch input) connected through the real PeerJS service over WebRTC: creating a room, joining by invite link, ready-up, start, movement, shared hazards, live scores, a dropped connection reconnecting, results, rematch, a mode change and the host leaving.
