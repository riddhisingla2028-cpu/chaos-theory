import { useEffect, useRef } from 'react';

/** Animated backdrop for the menus: a perspective neon floor, a horizon glow and drifting geometry. */
export function LobbyBackground({ accent = [79, 227, 240] as [number, number, number], still = false }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const accentRef = useRef(accent);
  accentRef.current = accent;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // Floating shapes at different depths.
    const shapes = Array.from({ length: 22 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.3 + Math.random() * 0.7,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.6,
      sides: [3, 4, 4, 6][i % 4],
      hazard: i % 7 === 0,
    }));

    const draw = (now: number) => {
      const t = now / 1000;
      const [r, g, b] = accentRef.current;
      const neon = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#050507';
      ctx.fillRect(0, 0, w, h);

      const horizon = h * 0.58;
      // Sky haze
      const sky = ctx.createRadialGradient(w / 2, horizon, 0, w / 2, horizon, Math.max(w, h) * 0.8);
      sky.addColorStop(0, neon(0.16));
      sky.addColorStop(0.35, 'rgba(255, 79, 216, 0.05)');
      sky.addColorStop(1, 'rgba(5,5,7,0)');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Perspective floor
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, horizon, w, h - horizon);
      ctx.clip();
      const floor = ctx.createLinearGradient(0, horizon, 0, h);
      floor.addColorStop(0, 'rgba(5,5,7,1)');
      floor.addColorStop(1, 'rgba(12,10,20,1)');
      ctx.fillStyle = floor;
      ctx.fillRect(0, horizon, w, h - horizon);
      ctx.lineWidth = 1;
      const scroll = still ? 0 : (t * 0.35) % 1;
      for (let i = 0; i < 18; i++) {
        const z = (i + 1 - scroll) / 18;
        const y = horizon + (h - horizon) * z * z;
        ctx.strokeStyle = neon(0.08 + z * 0.35);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = -14; i <= 14; i++) {
        ctx.strokeStyle = neon(0.18);
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * 6, horizon);
        ctx.lineTo(w / 2 + i * w * 0.16, h);
        ctx.stroke();
      }
      ctx.restore();

      // Horizon glow line
      ctx.save();
      ctx.shadowColor = neon(1);
      ctx.shadowBlur = 24;
      ctx.strokeStyle = neon(0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      ctx.lineTo(w, horizon);
      ctx.stroke();
      ctx.restore();

      // Drifting geometry
      for (const s of shapes) {
        if (!still) {
          s.y -= 0.012 * s.z * (1 / 60);
          s.rot += s.spin / 60;
          if (s.y < -0.1) {
            s.y = 1.05;
            s.x = Math.random();
          }
        }
        const size = 6 + s.z * 18;
        const x = s.x * w;
        const y = s.y * h;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(s.rot);
        ctx.globalAlpha = 0.15 + s.z * 0.35;
        ctx.strokeStyle = s.hazard ? 'rgba(200, 75, 75, 0.9)' : 'rgba(243, 240, 234, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k = 0; k <= s.sides; k++) {
          const a = (k / s.sides) * Math.PI * 2;
          if (k === 0) ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size);
          else ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Vignette
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const onVisible = () => {
      if (!document.hidden && !still) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [still]);

  return <canvas ref={ref} className="lobby-bg" aria-hidden="true" />;
}
