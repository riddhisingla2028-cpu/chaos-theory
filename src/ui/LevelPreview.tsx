import { useEffect, useRef } from 'react';
import { createGame, step, type GameConfig } from '../game/engine';
import { createAutopilot } from '../game/autopilot';
import { Fx } from '../game/fx';
import { drawGame, type Look } from '../game/render';

/**
 * A live, looping glimpse of a level, played by the autopilot with the real engine and renderer.
 * Locked levels loop only their opening seconds, so the preview intrigues without spoiling.
 */
export function LevelPreview({ config, look, clip, label }: { config: GameConfig; look: Look; clip: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lookRef = useRef(look);
  lookRef.current = look;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let size = 0;
    const resize = () => {
      size = canvas.clientWidth;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let seed = 11;
    let g = createGame(seed, config);
    let pilot = createAutopilot();
    const fx = new Fx();
    let holdUntil = 0;
    let last = performance.now();
    let raf = 0;

    const restart = () => {
      seed += 1;
      g = createGame(seed * 7919, config);
      pilot = createAutopilot();
      fx.reset();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (g.status === 'playing' && g.time < clip) {
        for (let left = dt; left > 0 && g.status === 'playing'; left -= 1 / 120) step(g, pilot(g), Math.min(left, 1 / 120));
        for (const e of g.events.splice(0)) {
          if (e.type === 'orb') fx.burst(e.x, e.y, 14, 260, false, 5, 0.5);
          else if (e.type === 'death') fx.burst(e.x, e.y, 30, 420, true, 7, 0.9);
          else if (e.type === 'bossHit') fx.burst(e.x, e.y, 24, 380, true, 6, 0.8);
          else if (e.type === 'victory') fx.confetti(500, 500, 60, ['#4FE3F0', '#FF4FD8', '#FFD54A', '#F3F0EA']);
        }
        if (g.status !== 'playing' || g.time >= clip) holdUntil = now + 900;
      } else if (now > holdUntil) {
        restart();
      }
      fx.update(dt);
      if (size > 0) drawGame(ctx, g, size, dpr, now / 1000, fx, { ...lookRef.current, shake: false });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [config, clip]);

  return <canvas ref={ref} className="preview-canvas" role="img" aria-label={label} />;
}
