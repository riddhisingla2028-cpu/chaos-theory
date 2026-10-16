# Chaos Theory

A minimalist single-player browser survival game where the rules keep changing.

You control a square inside an arena and survive for as long as you can while hazards close in. Every few seconds a **chaos event** rewrites the rules:

| Event | Effect |
|---|---|
| **Inversion** | Movement controls are reversed. |
| **Collapse** | The walls close in; touching the red zone is fatal. |
| **Afterimage** | Your recent trail becomes lethal, so you have to keep moving. |
| **Gravity Shift** | A directional force drags you off course. |

Each event is announced with a 1.6-second warning, lasts 6 seconds, and never repeats twice in a row.

## Features

- Start, pause, and game-over screens, plus restart
- Keyboard controls (WASD or arrow keys) and a touch joystick on mobile (drag anywhere)
- Two hazard types: drifters cross the arena, and seekers (from 30 seconds) steer towards you
- Score based on survival time (10 points per second)
- Difficulty ramps up continuously: faster and more frequent hazards, with the level rising every 15 seconds
- Game-over statistics: score, time survived, level reached, chaos events survived, hazards dodged, and cause of death
- Personal best saved in the browser (`localStorage`)
- Responsive layout for desktop and mobile; auto-pauses when the tab loses focus

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | `WASD` / arrow keys | Drag anywhere on the play area |
| Start / play again | `Space` / `Enter` / `R` | Tap the button |
| Pause / resume | `P` / `Esc` | Tap the pause button |

## Tech stack

React 18, TypeScript, and Vite, with the game drawn on an HTML Canvas. There is no backend, no accounts, no paid APIs, and no environment variables or secrets.

```
src/
  game/engine.ts   Pure game simulation (movement, hazards, collisions, chaos events, difficulty)
  game/render.ts   Canvas rendering
  game/input.ts    Keyboard and touch-joystick input
  storage.ts       Personal-best persistence (safe if storage is blocked)
  App.tsx          Screens, HUD, game loop, resizing
```

## Run locally

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Test and build

```bash
npm test           # 26 unit tests covering every mechanic
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

The unit tests cover scoring, difficulty scaling, hazard spawning, movement and wall clamping, collisions, all four chaos events (including that Afterimage ignores trail laid before it starts and that Gravity can be resisted), event scheduling, keyboard and touch input, and personal-best storage, including blocked or corrupted storage.
