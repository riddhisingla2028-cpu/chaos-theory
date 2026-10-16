import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  ARENA,
  CHAOS_INFO,
  COMBO_WINDOW,
  ENDLESS_CONFIG,
  ORB_POINTS,
  createGame,
  finalScore,
  goalSeconds,
  multiplier,
  step,
  type ChaosKind,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Vec,
} from './game/engine';
import { drawGame, type Look } from './game/render';
import { Fx } from './game/fx';
import { Sfx } from './game/audio';
import { Input } from './game/input';
import { STAGES, TRIALS, dailyChallenge, objectiveText, stageConfig, trialConfig, type Motif } from './game/stages';
import {
  applyRun,
  canOfferSkip,
  defaultProgress,
  loadProgress,
  nextStage,
  saveProgress,
  setPremiumDemo,
  skipLevel,
  themeById,
  type Progress,
  type RunSummary,
  type Settings,
} from './progress';
import { IconButton, PauseIcon, PlayIcon, SoundIcon } from './ui/common';
import { Collection, SettingsScreen, Tutorial } from './ui/Menus';
import { GameOverScreen, PausedScreen, VictoryScreen, type Result } from './ui/Results';
import { HomeScreen, LevelMap, PremiumScreen, RecordsScreen, SplashScreen } from './ui/Lobby';
import { LobbyBackground } from './ui/LobbyBackground';

type Screen =
  | 'splash'
  | 'home'
  | 'levels'
  | 'collection'
  | 'records'
  | 'settings'
  | 'premium'
  | 'tutorial'
  | 'playing'
  | 'paused'
  | 'over'
  | 'won';

const LOBBY: ReadonlySet<Screen> = new Set(['splash', 'home', 'levels', 'collection', 'records', 'settings', 'premium', 'tutorial']);

type RGB = [number, number, number];
const CYAN: RGB = [79, 227, 240];
const MAGENTA: RGB = [255, 79, 216];
const rgb = (c: RGB) => `rgb(${c.join(',')})`;

interface Run {
  config: GameConfig;
  seed: number;
  label: string;
  motif: Motif;
  heat: number;
  glow: RGB;
  intro: { kicker: string; title: string; detail: string };
  dateKey?: string;
}

interface Hud {
  score: number;
  time: number;
  mult: number;
  comboFrac: number;
  chaos: { kind: ChaosKind; partner: ChaosKind | null; phase: 'warning' | 'active'; progress: number; gravity: Vec } | null;
  playerNearTop: boolean; // fade the banner so it never hides the player
  warmup: number; // seconds of warm-up left
  orbs: number;
  boss: { hp: number; maxHp: number } | null;
}

const JOY_RADIUS: Record<Settings['joySize'], number> = { S: 44, M: 56, L: 72 };
const JOY_DEADZONE = 6; // px
const MAX_STEP = 1 / 120; // simulation substep, seconds
const HUD_INTERVAL = 0.066; // seconds between HUD refreshes
const RESTART_DELAY = 450; // ms after a run ends before keys can restart

function makeStageRun(i: number): Run {
  const st = STAGES[i];
  return {
    config: stageConfig(i),
    seed: Date.now(),
    label: `Level ${i + 1}`,
    motif: st.motif,
    heat: st.heat,
    glow: st.accent,
    intro: { kicker: `Level ${i + 1} of ${STAGES.length}`, title: st.name, detail: objectiveText(st.objective) },
  };
}

function makeTrialRun(i: number): Run {
  const t = TRIALS[i];
  return {
    config: trialConfig(i),
    seed: Date.now(),
    label: `Trial · ${t.name}`,
    motif: t.motif,
    heat: 0.4,
    glow: t.accent,
    intro: { kicker: 'Chaos+ trial', title: t.name, detail: t.tagline },
  };
}

function makeEndlessRun(): Run {
  return {
    config: ENDLESS_CONFIG,
    seed: Date.now(),
    label: 'Endless',
    motif: 'grid',
    heat: 0.1,
    glow: CYAN,
    intro: { kicker: 'Endless', title: 'Survive', detail: 'New rules join the longer you last' },
  };
}

function makeDailyRun(): Run {
  const d = dailyChallenge();
  return {
    config: d.config,
    seed: d.seed,
    label: `Daily · ${d.key}`,
    motif: 'dots',
    heat: 0.2,
    glow: MAGENTA,
    dateKey: d.key,
    intro: { kicker: `Daily challenge · ${d.key}`, title: d.mutator.name, detail: d.mutator.desc },
  };
}

function freshRun(run: Run): Run {
  if (run.config.mode === 'stage') return makeStageRun(run.config.stage);
  if (run.config.mode === 'trial') return makeTrialRun(run.config.stage);
  if (run.config.mode === 'daily') return makeDailyRun();
  return makeEndlessRun();
}

function hudFrom(g: GameState): Hud {
  const c = g.chaos;
  return {
    score: finalScore(g),
    time: g.time,
    mult: multiplier(g),
    comboFrac: g.combo > 0 ? Math.max(0, g.comboTimer / COMBO_WINDOW) : 0,
    chaos: c ? { kind: c.kind, partner: c.partner, phase: c.phase, progress: 1 - c.remaining / c.duration, gravity: c.gravity } : null,
    playerNearTop: g.player.y < ARENA * 0.2,
    warmup: Math.max(0, g.config.warmup - g.time),
    orbs: g.stats.orbs,
    boss: g.boss ? { hp: g.boss.hp, maxHp: g.boss.maxHp } : null,
  };
}

function arrowFor(v: Vec): string {
  if (v.x > 0) return '→';
  if (v.x < 0) return '←';
  if (v.y > 0) return '↓';
  return '↑';
}

function matches(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export default function App() {
  const [progress, setProgressState] = useState<Progress>(() => loadProgress());
  const progressRef = useRef(progress);
  const settings = progress.settings;

  const [screen, setScreenState] = useState<Screen>('splash');
  const screenRef = useRef<Screen>('splash');
  const runRef = useRef<Run>(makeEndlessRun());
  const pendingRunRef = useRef<Run | null>(null);
  const gameRef = useRef<GameState>(createGame(1, ENDLESS_CONFIG));
  const inputRef = useRef(new Input());
  const fxRef = useRef(new Fx());
  const sfxRef = useRef(new Sfx());
  const [hud, setHud] = useState<Hud>(() => hudFrom(gameRef.current));
  const [result, setResult] = useState<Result | null>(null);
  const [introKey, setIntroKey] = useState(0);
  const [levelsFocus, setLevelsFocus] = useState(() => Math.max(0, nextStage(loadProgress())));
  const [isTouch] = useState(() => matches('(pointer: coarse)'));
  const [reducedMotion] = useState(() => matches('(prefers-reduced-motion: reduce)'));
  const overAtRef = useRef(0);
  const multFloorRef = useRef(1);
  const lastAttemptRef = useRef(new Map<string, number>());

  const stageRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const joyBaseRef = useRef<HTMLDivElement>(null);
  const joyKnobRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const sizeRef = useRef(0);
  const dprRef = useRef(1);

  // Development-only hook for automated browser tests; removed from production builds.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as { __chaosGame: () => GameState; __chaosProgress: () => Progress };
      w.__chaosGame = () => gameRef.current;
      w.__chaosProgress = () => progressRef.current;
    }
  }, []);

  useEffect(() => {
    sfxRef.current.muted = settings.muted;
  }, [settings.muted]);

  const updateProgress = useCallback((next: Progress) => {
    progressRef.current = next;
    setProgressState(next);
    saveProgress(next);
  }, []);

  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      const p = progressRef.current;
      updateProgress({ ...p, settings: { ...p.settings, ...patch } });
    },
    [updateProgress],
  );

  const toggleMute = useCallback(() => {
    const muted = !progressRef.current.settings.muted;
    sfxRef.current.muted = muted;
    changeSettings({ muted });
    if (!muted) {
      sfxRef.current.unlock();
      sfxRef.current.play('click');
    }
  }, [changeSettings]);

  const setScreen = useCallback((next: Screen) => {
    const prev = screenRef.current;
    screenRef.current = next;
    setScreenState(next);
    if (LOBBY.has(prev) && LOBBY.has(next) && prev !== next && prev !== 'splash') sfxRef.current.play('whoosh');
  }, []);

  // Menu music: on in the lobby, off in game.
  useEffect(() => {
    const sfx = sfxRef.current;
    const want = LOBBY.has(screen) && screen !== 'splash' && settings.music && !settings.muted;
    sfx.setAmbient(want);
    if (want) {
      const retry = window.setTimeout(() => sfx.setAmbient(true), 400); // audio context may still be resuming
      return () => window.clearTimeout(retry);
    }
  }, [screen, settings.music, settings.muted]);

  // Subtle hover/click feedback on every button (mouse only for hover).
  useEffect(() => {
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && (e.target as Element).closest?.('button:not(:disabled)')) sfxRef.current.play('hover');
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element).closest?.('button')) sfxRef.current.play('click');
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('click', onClick);
    };
  }, []);

  const hideJoystick = useCallback(() => {
    const joy = inputRef.current.joy;
    Object.assign(joy, { active: false, id: -1, x: 0, y: 0 });
    const base = joyBaseRef.current;
    if (!base) return;
    const fixed = progressRef.current.settings.joyMode === 'fixed' && screenRef.current === 'playing' && isTouch;
    base.hidden = !fixed;
    base.classList.remove('joystick-live');
    if (joyKnobRef.current) joyKnobRef.current.style.transform = 'translate(0px, 0px)';
  }, [isTouch]);

  // ---------- Run lifecycle ----------

  const startRun = useCallback(
    (run: Run) => {
      sfxRef.current.unlock();
      runRef.current = run;
      gameRef.current = createGame(run.seed, run.config);
      inputRef.current.reset();
      fxRef.current.reset();
      multFloorRef.current = 1;
      setResult(null);
      setHud(hudFrom(gameRef.current));
      setIntroKey((k) => k + 1);
      sfxRef.current.play('start');
      setScreen('playing');
      hideJoystick();
    },
    [hideJoystick, setScreen],
  );

  const beginRun = useCallback(
    (run: Run) => {
      sfxRef.current.unlock();
      if (!progressRef.current.tutorialSeen) {
        pendingRunRef.current = run;
        setScreen('tutorial');
        return;
      }
      startRun(run);
    },
    [setScreen, startRun],
  );

  const playNext = useCallback(() => {
    const n = nextStage(progressRef.current);
    beginRun(n >= 0 ? makeStageRun(n) : makeEndlessRun());
  }, [beginRun]);

  const retry = useCallback(() => startRun(freshRun(runRef.current)), [startRun]);

  const advance = useCallback(() => {
    const cfg = runRef.current.config;
    if (cfg.mode === 'trial') return retry();
    const i = cfg.stage;
    startRun(i >= 0 && i < STAGES.length - 1 ? makeStageRun(i + 1) : makeEndlessRun());
  }, [retry, startRun]);

  const pause = useCallback(() => {
    if (screenRef.current !== 'playing') return;
    inputRef.current.reset();
    setScreen('paused');
    hideJoystick();
  }, [hideJoystick, setScreen]);

  const resume = useCallback(() => {
    if (screenRef.current !== 'paused') return;
    setScreen('playing');
    hideJoystick();
  }, [hideJoystick, setScreen]);

  const toLobby = useCallback(
    (next: Screen = 'home') => {
      runRef.current = makeEndlessRun();
      gameRef.current = createGame(1, ENDLESS_CONFIG);
      inputRef.current.reset();
      fxRef.current.reset();
      setResult(null);
      setHud(hudFrom(gameRef.current));
      setScreen(next);
      hideJoystick();
    },
    [hideJoystick, setScreen],
  );

  const openLevels = useCallback(
    (focus?: number) => {
      setLevelsFocus(focus ?? Math.max(0, nextStage(progressRef.current)));
      toLobby('levels');
    },
    [toLobby],
  );

  const finishTutorial = useCallback(() => {
    updateProgress({ ...progressRef.current, tutorialSeen: true });
    const run = pendingRunRef.current;
    pendingRunRef.current = null;
    if (run) startRun(run);
    else setScreen('home');
  }, [setScreen, startRun, updateProgress]);

  const endRun = useCallback(
    (won: boolean) => {
      const g = gameRef.current;
      const run = runRef.current;
      const summary: RunSummary = {
        mode: run.config.mode,
        stage: run.config.stage,
        won,
        score: finalScore(g),
        time: g.time,
        nearMisses: g.stats.nearMisses,
        peakMultiplier: g.stats.peakMultiplier,
        chaosSurvived: [...g.stats.chaosSurvived],
        orbs: g.stats.orbs,
        label: run.label,
        dateKey: run.dateKey,
      };
      const outcome = applyRun(progressRef.current, summary);
      updateProgress(outcome.progress);
      // Compare with the previous attempt at the same thing, so every run shows progress.
      const attemptKey = `${run.config.mode}:${run.config.stage}`;
      const previousTime = lastAttemptRef.current.get(attemptKey) ?? null;
      lastAttemptRef.current.set(attemptKey, g.time);
      setResult({
        summary,
        outcome,
        cause: g.cause,
        stats: { ...g.stats },
        label: run.label,
        previousTime,
        boss: g.boss ? { hp: g.boss.hp, maxHp: g.boss.maxHp } : null,
      });
      overAtRef.current = performance.now();
      inputRef.current.reset();
      setHud(hudFrom(g));
      if (outcome.newAchievements.length > 0 || outcome.newUnlocks.length > 0) {
        window.setTimeout(() => sfxRef.current.play('unlock'), 900);
      }
      setScreen(won ? 'won' : 'over');
      hideJoystick();
    },
    [hideJoystick, setScreen, updateProgress],
  );

  const skipCurrent = useCallback(() => {
    const stage = runRef.current.config.stage;
    updateProgress(skipLevel(progressRef.current, stage));
    sfxRef.current.play('levelup');
    openLevels(Math.min(stage + 1, STAGES.length - 1));
  }, [openLevels, updateProgress]);

  // Translate simulation events into juice: particles, popups, shake and sound.
  const handleEvent = useCallback((e: GameEvent) => {
    const fx = fxRef.current;
    const sfx = sfxRef.current;
    const p = gameRef.current.player;
    const glow = rgb(runRef.current.glow);
    switch (e.type) {
      case 'nearMiss':
        fx.burst(e.x, e.y, 6, 160, false, 4, 0.4);
        fx.popup(e.x, e.y - 26, 'NEAR');
        sfx.play('near');
        break;
      case 'gapPass':
        fx.burst(e.x, e.y, 12, 240, false, 4, 0.5);
        fx.popup(e.x, e.y - 34, 'THREADED');
        sfx.play('pass');
        break;
      case 'chaosWarning':
        sfx.play('warning');
        break;
      case 'chaosStart':
        fx.flash = 0.7;
        fx.addShake(e.partner ? 12 : 8);
        sfx.play('chaos');
        break;
      case 'chaosEnd':
        fx.burst(p.x, p.y, 14, 260, true, 4, 0.6);
        fx.popup(p.x, p.y - 40, 'SURVIVED');
        sfx.play('combo');
        break;
      case 'glitch':
        fx.addShake(3);
        sfx.play('glitch');
        break;
      case 'teleport':
        fx.burst(e.x, e.y, 10, 180, true, 4, 0.4);
        break;
      case 'comboLost':
        if (e.combo >= 5) fx.popup(p.x, p.y - 34, 'COMBO LOST');
        break;
      case 'warmupEnd':
        fx.popup(ARENA / 2, ARENA * 0.42, 'GO', true);
        fx.burst(p.x, p.y, 16, 220, false, 4, 0.5);
        sfx.play('start');
        break;
      case 'milestone':
        fx.popup(ARENA / 2, ARENA * 0.36, `${e.seconds}s`, true);
        fx.popup(ARENA / 2, ARENA * 0.46, `+${e.bonus}`);
        fx.burst(p.x, p.y, 20, 300, true, 4, 0.7);
        fx.flash = Math.max(fx.flash, 0.25);
        sfx.play('unlock');
        break;
      case 'pattern':
        sfx.play('click');
        break;
      case 'orb':
        fx.confetti(e.x, e.y, 18, [glow, '#F3F0EA']);
        fx.popup(e.x, e.y - 30, e.target ? `${e.collected}/${e.target}` : `+${ORB_POINTS}`);
        sfx.play('orb');
        break;
      case 'voidWarn':
        sfx.play('warning');
        break;
      case 'bossTell':
        sfx.play(e.kind === 'beam' ? 'beam' : 'warning');
        break;
      case 'bossHit':
        fx.burst(e.x, e.y, 30, 420, true, 7, 0.9);
        fx.popup(e.x, e.y - 80, e.hp > 0 ? `CORE ${e.hp}` : 'CORE DOWN', true);
        fx.addShake(12);
        fx.flash = 0.6;
        sfx.play('bossHit');
        break;
      case 'bossDefeated':
        fx.confetti(e.x, e.y, 120, [glow, '#FF4FD8', '#4FE3F0', '#F3F0EA']);
        fx.addShake(28);
        fx.flash = 1;
        break;
      case 'death':
        fx.burst(e.x, e.y, 46, 480, true, 8, 1);
        fx.burst(e.x, e.y, 18, 260, false, 5, 0.8);
        fx.addShake(24);
        fx.flash = 1;
        sfx.play('death');
        try {
          navigator.vibrate?.(70);
        } catch {
          // vibration unsupported
        }
        break;
      case 'victory':
        fx.confetti(ARENA / 2, ARENA / 2, 110, [glow, '#FF4FD8', '#4FE3F0', '#FFD54A', '#F3F0EA']);
        fx.burst(p.x, p.y, 30, 300, false, 5, 1);
        sfx.play('levelup');
        break;
    }
  }, []);

  // ---------- Keyboard ----------

  useEffect(() => {
    const input = inputRef.current;
    const canAct = () => performance.now() - overAtRef.current > RESTART_DELAY;

    const onKeyDown = (e: KeyboardEvent) => {
      const s = screenRef.current;
      if (s === 'splash') {
        e.preventDefault();
        enterFromSplash();
        return;
      }
      if (input.handleKey(e.code, true) && s === 'playing') e.preventDefault();
      if (e.repeat) return;
      // Let a focused button handle Enter/Space natively, so it never fires twice.
      const onButton = document.activeElement instanceof HTMLButtonElement;
      switch (e.code) {
        case 'Space':
        case 'Enter':
        case 'NumpadEnter':
          if (s === 'playing') e.preventDefault();
          if (onButton) return;
          if (s === 'home') playNext();
          else if (s === 'over' && canAct()) retry();
          else if (s === 'won' && canAct()) advance();
          else if (s === 'paused') resume();
          break;
        case 'KeyP':
          if (s === 'playing') pause();
          else if (s === 'paused') resume();
          break;
        case 'Escape':
          if (s === 'playing') pause();
          else if (s === 'paused') resume();
          else if (s === 'levels' || s === 'collection' || s === 'records' || s === 'settings' || s === 'premium') setScreen('home');
          break;
        case 'KeyR':
          if (s === 'paused' || ((s === 'over' || s === 'won') && canAct())) retry();
          break;
        case 'KeyM':
          toggleMute();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      input.handleKey(e.code, false);
    };
    const onBlur = () => {
      input.reset();
      pause();
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  function enterFromSplash() {
    if (screenRef.current !== 'splash') return;
    const sfx = sfxRef.current;
    sfx.unlock();
    sfx.play('boot');
    setScreen('home');
  }

  // Ask before leaving or refreshing the page in the middle of a real run.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      const s = screenRef.current;
      if ((s === 'playing' || s === 'paused') && gameRef.current.time > 3) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  // Block scrolling, pinch-zoom and double-tap zoom while playing.
  useEffect(() => {
    const whilePlaying = (e: Event) => {
      if (screenRef.current === 'playing') e.preventDefault();
    };
    const always = (e: Event) => e.preventDefault();
    document.addEventListener('touchmove', whilePlaying, { passive: false });
    document.addEventListener('dblclick', whilePlaying);
    document.addEventListener('gesturestart', always);
    return () => {
      document.removeEventListener('touchmove', whilePlaying);
      document.removeEventListener('dblclick', whilePlaying);
      document.removeEventListener('gesturestart', always);
    };
  }, []);

  // ---------- Layout ----------

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = Math.max(200, Math.floor(Math.min(rect.width, rect.height)));
      sizeRef.current = next;
      setSize(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }, [size]);

  // ---------- Main loop ----------

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudClock = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = gameRef.current;
      const fx = fxRef.current;
      const s = screenRef.current;
      if (s === 'playing') {
        const input = inputRef.current.vector();
        let remaining = dt;
        while (remaining > 0 && g.status === 'playing') {
          const h = Math.min(remaining, MAX_STEP);
          step(g, input, h);
          remaining -= h;
        }
        for (const e of g.events.splice(0)) handleEvent(e);
        const floor = Math.floor(multiplier(g));
        if (floor > multFloorRef.current) {
          fx.popup(ARENA / 2, ARENA * 0.42, `×${floor}`, true);
          fx.flash = Math.max(fx.flash, 0.3);
          sfxRef.current.play('combo');
        }
        multFloorRef.current = floor;
        fx.thrust(g, dt);
        hudClock += dt;
        if (g.status === 'over') endRun(false);
        else if (g.status === 'won') endRun(true);
        else if (hudClock >= HUD_INTERVAL) {
          hudClock = 0;
          setHud(hudFrom(g));
        }
      }
      if (s !== 'paused') fx.update(dt);
      // The arena is hidden behind the lobby, so skip drawing it there.
      const ctx = !LOBBY.has(s) ? canvasRef.current?.getContext('2d') : null;
      if (ctx && sizeRef.current) {
        const st = progressRef.current.settings;
        const theme = themeById(st.theme);
        const run = runRef.current;
        const look: Look = {
          arena: theme.arena,
          accent: theme.accent,
          glow: run.glow,
          shape: st.shape,
          motif: run.motif,
          heat: run.heat,
          shake: st.shake && !reducedMotion,
        };
        drawGame(ctx, g, sizeRef.current, dprRef.current, now / 1000, fx, look);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [endRun, handleEvent, reducedMotion]);

  // ---------- Touch joystick ----------

  const joyRadius = JOY_RADIUS[settings.joySize];

  /** Where the fixed joystick sits: in the free space below (portrait) or beside (landscape) the arena. */
  const fixedOrigin = useCallback((): Vec => {
    const stage = stageRef.current!.getBoundingClientRect();
    const arena = arenaRef.current!.getBoundingClientRect();
    const r = JOY_RADIUS[progressRef.current.settings.joySize];
    if (stage.bottom - arena.bottom >= r * 2 + 24) return { x: stage.left + stage.width / 2, y: (arena.bottom + stage.bottom) / 2 };
    if (arena.left - stage.left >= r * 2 + 24) return { x: (stage.left + arena.left) / 2, y: stage.bottom - r - 24 };
    return { x: stage.left + r + 16, y: stage.bottom - r - 16 };
  }, []);

  const placeJoystick = useCallback(
    (x: number, y: number) => {
      const base = joyBaseRef.current;
      if (!base) return;
      base.style.left = `${x - joyRadius}px`;
      base.style.top = `${y - joyRadius}px`;
      base.style.width = base.style.height = `${joyRadius * 2}px`;
    },
    [joyRadius],
  );

  // Show the fixed joystick in place whenever a run is in progress.
  useEffect(() => {
    if (!isTouch || settings.joyMode !== 'fixed' || screen !== 'playing' || !stageRef.current || !arenaRef.current) return;
    const o = fixedOrigin();
    placeJoystick(o.x, o.y);
    if (joyBaseRef.current) joyBaseRef.current.hidden = false;
  }, [fixedOrigin, isTouch, placeJoystick, screen, settings.joyMode, size]);

  const moveKnob = (clientX: number, clientY: number) => {
    const joy = inputRef.current.joy;
    let dx = clientX - joy.ox;
    let dy = clientY - joy.oy;
    const dist = Math.hypot(dx, dy);
    if (dist > joyRadius) {
      dx = (dx / dist) * joyRadius;
      dy = (dy / dist) * joyRadius;
    }
    const live = dist > JOY_DEADZONE;
    joy.x = live ? dx / joyRadius : 0;
    joy.y = live ? dy / joyRadius : 0;
    if (joyKnobRef.current) joyKnobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || screenRef.current !== 'playing') return;
    const joy = inputRef.current.joy;
    if (joy.active) return;
    e.preventDefault();
    const origin = settings.joyMode === 'fixed' ? fixedOrigin() : { x: e.clientX, y: e.clientY };
    Object.assign(joy, { active: true, id: e.pointerId, ox: origin.x, oy: origin.y, x: 0, y: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
    placeJoystick(origin.x, origin.y);
    if (joyBaseRef.current) {
      joyBaseRef.current.hidden = false;
      joyBaseRef.current.classList.add('joystick-live');
    }
    moveKnob(e.clientX, e.clientY);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const joy = inputRef.current.joy;
    if (!joy.active || e.pointerId !== joy.id) return;
    moveKnob(e.clientX, e.clientY);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const joy = inputRef.current.joy;
    if (!joy.active || e.pointerId !== joy.id) return;
    hideJoystick();
  };

  // ---------- Render ----------

  const theme = themeById(settings.theme);
  const run = runRef.current;
  const appStyle = { '--danger': rgb(theme.accent), '--arena': theme.arena, '--lvl': rgb(run.glow) } as CSSProperties;
  const inGame = screen === 'playing' || screen === 'paused';
  const showRunHud = inGame || screen === 'over' || screen === 'won';
  const objective = run.config.objective;
  const goal = goalSeconds(run.config);
  const chaos = inGame ? hud.chaos : null;
  const daily = useMemo(() => dailyChallenge(), [screen]); // refreshed whenever screens change
  const dailyBest = progress.daily && progress.daily.date === daily.key ? progress.daily.best : 0;
  const lobby = LOBBY.has(screen);
  const lobbyAccent: RGB = screen === 'levels' ? STAGES[levelsFocus].accent : screen === 'premium' ? MAGENTA : CYAN;

  let runBest = 0;
  if (run.config.mode === 'stage') runBest = progress.stages[run.config.stage]?.best ?? 0;
  else if (run.config.mode === 'trial') runBest = progress.trialBest[run.config.stage] ?? 0;
  else if (run.config.mode === 'endless') runBest = progress.endlessBest;
  else runBest = progress.daily && progress.daily.date === run.dateKey ? progress.daily.best : 0;

  // Objective display: time, orbs or boss health.
  let objStat: { label: string; value: string; urgent?: boolean } = { label: 'Time', value: `${hud.time.toFixed(1)}s` };
  let objFrac: number | null = null;
  if (objective?.type === 'survive' && goal) {
    objStat = { label: 'Time', value: `${hud.time.toFixed(1)}/${goal}` };
    objFrac = Math.min(1, hud.time / goal);
  } else if (objective?.type === 'orbs' && objective.orbs) {
    const left = objective.timeLimit ? Math.max(0, objective.timeLimit - hud.time) : null;
    objStat = left !== null ? { label: 'Time left', value: `${left.toFixed(1)}s`, urgent: left < 5 } : objStat;
    objFrac = hud.orbs / objective.orbs;
  } else if (objective?.type === 'boss' && hud.boss) {
    objFrac = (hud.boss.maxHp - hud.boss.hp) / hud.boss.maxHp;
  }
  const modeStat =
    run.config.mode === 'stage'
      ? { label: 'Level', value: `${run.config.stage + 1}/${STAGES.length}` }
      : objective?.type === 'orbs' || objective?.type === 'boss'
        ? { label: 'Mode', value: 'Trial' }
        : { label: 'Mode', value: run.config.mode === 'daily' ? 'Daily' : run.config.mode === 'trial' ? 'Trial' : 'Endless' };

  return (
    <div className={`app app-${screen}`} style={appStyle}>
      <header className="hud">
        {showRunHud ? (
          <>
            <div className="hud-score">
              <span className="stat-label">Score</span>
              <span className="hud-score-value">{hud.score.toLocaleString()}</span>
              <span className={`mult${hud.mult > 1.001 ? ' mult-on' : ''}`} aria-label={`Multiplier ${hud.mult.toFixed(1)}`}>
                ×{hud.mult.toFixed(1)}
                <span className="mult-timer" style={{ transform: `scaleX(${hud.comboFrac})` }} />
              </span>
            </div>
            <div className="hud-stats">
              {objective?.type === 'orbs' && <Stat label="Orbs" value={`${hud.orbs}/${objective.orbs}`} highlight />}
              {objective?.type === 'boss' && hud.boss && <Stat label="Core" value={`${hud.boss.hp}/${hud.boss.maxHp}`} highlight />}
              <Stat label={objStat.label} value={objStat.value} urgent={objStat.urgent} />
              <Stat label={modeStat.label} value={modeStat.value} />
              <Stat label="Best" value={runBest.toLocaleString()} />
            </div>
          </>
        ) : (
          <span className="brand">Chaos Theory</span>
        )}
        <div className="hud-buttons">
          <IconButton label={settings.muted ? 'Unmute sound' : 'Mute sound'} onClick={toggleMute}>
            <SoundIcon muted={settings.muted} />
          </IconButton>
          {showRunHud && (
            <IconButton label={screen === 'paused' ? 'Resume game' : 'Pause game'} onClick={screen === 'paused' ? resume : pause} disabled={!inGame}>
              {screen === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </IconButton>
          )}
        </div>
        {objFrac !== null && showRunHud && (
          <div className="goal-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${objFrac})` }} />
          </div>
        )}
      </header>

      <div
        className="stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="arena" ref={arenaRef} style={{ width: size || undefined, height: size || undefined }}>
          <canvas ref={canvasRef} aria-label="Game arena" />
          {inGame && (
            // Short levels get a short intro so it never hides the first hazards.
            <div key={introKey} className="intro" aria-live="polite" style={{ animationDuration: `${Math.min(2.8, Math.max(1.5, run.config.warmup + 0.5))}s` }}>
              <span className="intro-kicker">{run.intro.kicker}</span>
              <span className="intro-title">{run.intro.title}</span>
              <span className="intro-detail">{run.intro.detail}</span>
            </div>
          )}
          {inGame && !chaos && hud.warmup > 0.3 && hud.time > 2.6 && (
            <div className="banner banner-warmup" role="status">
              <span className="banner-kicker">Warm-up</span>
              <span className="banner-name">{Math.ceil(hud.warmup)}</span>
              <span className="banner-hint">Hazards are slow. Get a feel for the controls</span>
              <span className="banner-bar">
                <span style={{ transform: `scaleX(${hud.warmup / run.config.warmup})` }} />
              </span>
            </div>
          )}
          {chaos && (
            <div className={`banner banner-${chaos.phase}${hud.playerNearTop ? ' banner-dim' : ''}`} role="status" aria-live="polite">
              <span className="banner-kicker">{chaos.phase === 'warning' ? (chaos.partner ? 'Incoming · double' : 'Incoming') : 'Chaos active'}</span>
              <span className="banner-name">
                {CHAOS_INFO[chaos.kind].name}
                {chaos.partner && <span className="banner-plus"> + {CHAOS_INFO[chaos.partner].name}</span>}
                {(chaos.kind === 'GRAVITY' || chaos.partner === 'GRAVITY') && <span className="banner-arrow"> {arrowFor(chaos.gravity)}</span>}
              </span>
              <span className="banner-hint">{chaos.partner ? 'Two rules at once. Stay calm' : CHAOS_INFO[chaos.kind].hint}</span>
              <span className="banner-bar">
                <span style={{ transform: `scaleX(${Math.max(0, 1 - chaos.progress)})` }} />
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="joystick" ref={joyBaseRef} hidden aria-hidden="true">
        <div className="joystick-knob" ref={joyKnobRef} />
      </div>

      {lobby && (
        <div className="lobby">
          <LobbyBackground accent={lobbyAccent} still={reducedMotion} />
          {screen === 'splash' && <SplashScreen isTouch={isTouch} onEnter={enterFromSplash} />}
          {(screen === 'home' || screen === 'tutorial') && (
            <HomeScreen
              progress={progress}
              daily={{ mutator: daily.mutator, best: dailyBest }}
              muted={settings.muted}
              isTouch={isTouch}
              onToggleSound={toggleMute}
              onPlay={playNext}
              onLevels={() => openLevels()}
              onEndless={() => beginRun(makeEndlessRun())}
              onDaily={() => beginRun(makeDailyRun())}
              onTrials={() => setScreen('premium')}
              onCollection={() => setScreen('collection')}
              onRecords={() => setScreen('records')}
              onSettings={() => setScreen('settings')}
              onPremium={() => setScreen('premium')}
              onTutorial={() => {
                pendingRunRef.current = null;
                setScreen('tutorial');
              }}
            />
          )}
          {screen === 'levels' && (
            <LevelMap
              progress={progress}
              themeLook={{ arena: theme.arena, accent: theme.accent, shape: settings.shape }}
              initial={levelsFocus}
              onPlay={(i) => beginRun(makeStageRun(i))}
              onBack={() => setScreen('home')}
            />
          )}
          {screen === 'collection' && (
            <Collection
              progress={progress}
              onShape={(shape) => changeSettings({ shape })}
              onTheme={(id) => changeSettings({ theme: id })}
              onPremium={() => setScreen('premium')}
              onBack={() => setScreen('home')}
            />
          )}
          {screen === 'records' && <RecordsScreen progress={progress} onBack={() => setScreen('home')} />}
          {screen === 'settings' && (
            <SettingsScreen
              settings={settings}
              onChange={changeSettings}
              onReset={() => updateProgress({ ...defaultProgress(), tutorialSeen: true, settings })}
              onBack={() => setScreen('home')}
            />
          )}
          {screen === 'premium' && (
            <PremiumScreen
              progress={progress}
              onUnlock={() => {
                updateProgress(setPremiumDemo(progressRef.current, true).progress);
                sfxRef.current.play('levelup');
              }}
              onRemove={() => updateProgress(setPremiumDemo(progressRef.current, false).progress)}
              onPlayTrial={(i) => beginRun(makeTrialRun(i))}
              onBack={() => setScreen('home')}
            />
          )}
          {screen === 'tutorial' && <Tutorial isTouch={isTouch} onDone={finishTutorial} />}
        </div>
      )}

      {screen === 'paused' && (
        <PausedScreen
          score={hud.score}
          time={hud.time}
          muted={settings.muted}
          onResume={resume}
          onRestart={retry}
          onToggleSound={toggleMute}
          onMenu={() => toLobby()}
        />
      )}
      {screen === 'over' && result && (
        <GameOverScreen
          result={result}
          progress={progress}
          isTouch={isTouch}
          canSkip={result.summary.mode === 'stage' && canOfferSkip(progress, result.summary.stage)}
          onRetry={retry}
          onMenu={() => toLobby()}
          onLevels={() => openLevels(result.summary.stage)}
          onSkip={skipCurrent}
        />
      )}
      {screen === 'won' && result && (
        <VictoryScreen
          result={result}
          isTouch={isTouch}
          onNext={advance}
          onRetry={retry}
          onLevels={() => (result.summary.mode === 'trial' ? toLobby('premium') : openLevels(Math.min(result.summary.stage + 1, STAGES.length - 1)))}
        />
      )}
    </div>
  );
}

function Stat({ label, value, highlight, urgent }: { label: string; value: string; highlight?: boolean; urgent?: boolean }) {
  return (
    <div className={`stat${highlight ? ' stat-highlight' : ''}${urgent ? ' stat-urgent' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
