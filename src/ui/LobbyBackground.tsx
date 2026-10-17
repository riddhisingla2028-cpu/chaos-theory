import { useEffect, useRef } from 'react';
import { HULLS, type ShipId } from '../mission/render';

type RGB = [number, number, number];

/**
 * The menus' cinematic backdrop: a space battlefield. Static layers (deep space, nebulae, a ringed
 * gas giant) are rendered once per resize to an offscreen canvas; the live layer draws parallax
 * stars, drifting asteroids and wreckage, distant tracer fire, and the player's ship as the
 * centrepiece with engine exhaust, navigation lights and the occasional blaster burst.
 * With reduced motion it draws a single still frame.
 */
export function LobbyBackground({ accent = [76, 157, 255] as RGB, still = false, ship = 'arrow' as ShipId, hero = true }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const accentRef = useRef(accent);
  accentRef.current = accent;
  const shipRef = useRef(ship);
  shipRef.current = ship;
  const heroRef = useRef(hero);
  heroRef.current = hero;
  const heroFade = useRef(hero ? 1 : 0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let backdrop: HTMLCanvasElement | null = null;

    // Deterministic pseudo-random so the scene is the same every visit.
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const stars = Array.from({ length: 220 }, () => ({ x: rnd(), y: rnd(), z: 0.15 + rnd() * 0.85, tw: rnd() * 6.28 }));
    const rocks = Array.from({ length: 9 }, (_, i) => ({
      x: rnd(),
      y: rnd(),
      r: 6 + rnd() * 22,
      z: 0.3 + rnd() * 0.7,
      rot: rnd() * 6.28,
      spin: (rnd() - 0.5) * 0.3,
      wreck: i % 3 === 0,
      verts: Array.from({ length: 8 }, () => 0.7 + rnd() * 0.3),
    }));
    const tracers: { x: number; y: number; vx: number; vy: number; life: number; amber: boolean }[] = [];
    const flashes: { x: number; y: number; life: number; size: number }[] = [];
    const bolts: { x: number; y: number; life: number }[] = [];
    // Fighters crossing far behind the hero: a blue wing pursued by amber raiders
    const fighters: { x: number; y: number; vx: number; vy: number; life: number; amber: boolean; s: number; fireIn: number }[] = [];
    const blasts: { x: number; y: number; life: number; size: number }[] = [];
    let nextTracer = 0;
    let nextVolley = 2;
    let nextWing = 1.5;

    const buildBackdrop = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const g = c.getContext('2d');
      if (!g) return null;
      g.scale(dpr, dpr);
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#03050b');
      sky.addColorStop(0.55, '#060a16');
      sky.addColorStop(1, '#02030a');
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // Nebulae: cold blue, and a warm amber dust lane
      const neb = (x: number, y: number, r: number, col: string) => {
        const n = g.createRadialGradient(x, y, 0, x, y, r);
        n.addColorStop(0, col);
        n.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = n;
        g.fillRect(0, 0, w, h);
      };
      const m = Math.max(w, h);
      neb(w * 0.78, h * 0.25, m * 0.55, 'rgba(40, 90, 200, 0.22)');
      neb(w * 0.15, h * 0.7, m * 0.5, 'rgba(255, 140, 50, 0.08)');
      neb(w * 0.5, h * 0.95, m * 0.45, 'rgba(30, 60, 140, 0.18)');
      // Gas giant, lit from the upper right, with rings
      const pr = Math.min(w, h) * 0.42;
      const px = w * 0.06;
      const py = h * 1.02;
      const body = g.createRadialGradient(px + pr * 0.35, py - pr * 0.45, pr * 0.1, px, py, pr);
      body.addColorStop(0, '#2c3f6e');
      body.addColorStop(0.55, '#121c36');
      body.addColorStop(1, '#05080f');
      g.fillStyle = body;
      g.beginPath();
      g.arc(px, py, pr, 0, Math.PI * 2);
      g.fill();
      // Atmosphere rim light
      g.strokeStyle = 'rgba(110, 170, 255, 0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px, py, pr, -Math.PI * 0.5, 0.1);
      g.stroke();
      // Bands
      g.save();
      g.beginPath();
      g.arc(px, py, pr, 0, Math.PI * 2);
      g.clip();
      g.strokeStyle = 'rgba(180, 200, 255, 0.05)';
      g.lineWidth = pr * 0.05;
      for (let k = -4; k <= 4; k++) {
        g.beginPath();
        g.ellipse(px, py + k * pr * 0.16, pr * 1.1, pr * 0.08, -0.2, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(200, 180, 140, 0.18)';
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(px, py, pr * 1.6, pr * 0.28, -0.2, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
      // Cloud structure: many soft blobs along a diagonal band, then dark dust lanes
      for (let i = 0; i < 40; i++) {
        const u = rnd();
        const cx = w * (0.35 + u * 0.7) + (rnd() - 0.5) * w * 0.2;
        const cy = h * (0.05 + u * 0.5) + (rnd() - 0.5) * h * 0.25;
        const r = m * (0.05 + rnd() * 0.14);
        const n = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        const warm = rnd() < 0.18;
        n.addColorStop(0, warm ? `rgba(255, 150, 70, ${0.03 + rnd() * 0.03})` : `rgba(70, 120, 230, ${0.04 + rnd() * 0.05})`);
        n.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = n;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'multiply';
      for (let i = 0; i < 5; i++) {
        const cx = w * (0.4 + rnd() * 0.6);
        const cy = h * (0.1 + rnd() * 0.4);
        const r = m * (0.06 + rnd() * 0.1);
        const n = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        n.addColorStop(0, 'rgba(10, 12, 20, 0.7)');
        n.addColorStop(1, 'rgba(255, 255, 255, 1)');
        g.fillStyle = n;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'source-over';
      // Distant capital ships holding the line, hazy with distance
      for (const [fx, fy, fl] of [[0.3, 0.2, 0.07], [0.52, 0.12, 0.045], [0.62, 0.62, 0.05]] as const) {
        const x = w * fx;
        const y = h * fy;
        const L = Math.min(w, h) * fl;
        g.fillStyle = 'rgba(18, 24, 40, 0.75)';
        g.beginPath();
        g.moveTo(x + L, y);
        g.lineTo(x + L * 0.1, y - L * 0.13);
        g.lineTo(x - L * 0.5, y - L * 0.16);
        g.lineTo(x - L, y - L * 0.1);
        g.lineTo(x - L, y + L * 0.1);
        g.lineTo(x - L * 0.5, y + L * 0.16);
        g.lineTo(x + L * 0.1, y + L * 0.13);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(120, 160, 230, 0.16)';
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = 'rgba(120, 170, 255, 0.55)';
        g.fillRect(x - L * 1.04, y - 2, 3, 1.5);
        g.fillRect(x - L * 1.04, y + 1, 3, 1.5);
        g.fillStyle = 'rgba(255, 220, 170, 0.35)';
        for (let k = 0; k < 6; k++) g.fillRect(x - L * 0.6 + k * L * 0.22, y - 1, 1, 1);
      }
      // A small distant moon
      const mx = w * 0.88;
      const my = h * 0.12;
      const mr = Math.min(w, h) * 0.035;
      const moon = g.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, 1, mx, my, mr);
      moon.addColorStop(0, '#9aa6bd');
      moon.addColorStop(1, '#1a2133');
      g.fillStyle = moon;
      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.fill();
      return c;
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      backdrop = w && h ? buildBackdrop() : null;
    };
    resize();
    window.addEventListener('resize', resize);

    /** Where the hero ship sits: beside the title on wide screens, high and to the right on phones. */
    const shipPose = () => {
      const wide = w >= 900;
      return wide
        ? { x: w * 0.74, y: h * 0.27, scale: Math.min(w, h) * 0.0056, alpha: 1 }
        : { x: w * 0.9, y: h * 0.135, scale: Math.min(w, h) * 0.004, alpha: 0.5 };
    };

    let last = performance.now();
    const draw = (now: number) => {
      const t = now / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (backdrop) ctx.drawImage(backdrop, 0, 0, w, h);
      else {
        ctx.fillStyle = '#04060c';
        ctx.fillRect(0, 0, w, h);
      }

      // Parallax stars drifting slowly left (the fleet is moving)
      for (const st of stars) {
        const x = (((st.x * w - t * 6 * st.z) % w) + w) % w;
        const y = st.y * h;
        const a = 0.2 + 0.6 * st.z * (0.75 + 0.25 * Math.sin(t * 1.5 + st.tw));
        ctx.fillStyle = `rgba(225, 235, 255, ${a})`;
        const sz = 0.6 + st.z * 1.4;
        ctx.fillRect(x, y, sz, sz);
      }

      // Distant combat: tracer fire and flashes far away (dim, never competing with the UI)
      if (!still) {
        nextTracer -= dt;
        if (nextTracer <= 0) {
          nextTracer = 0.25 + Math.random() * 0.9;
          const fromLeft = Math.random() < 0.5;
          const y = h * (0.1 + Math.random() * 0.45);
          const amber = Math.random() < 0.55;
          for (let k = 0; k < 3; k++) tracers.push({ x: fromLeft ? w * 0.05 : w * 0.95, y: y + k * 3, vx: (fromLeft ? 1 : -1) * (500 + Math.random() * 200), vy: (Math.random() - 0.5) * 60, life: 0.8 + k * 0.05, amber });
          if (Math.random() < 0.35) flashes.push({ x: w * (0.15 + Math.random() * 0.7), y: h * (0.08 + Math.random() * 0.4), life: 0.6, size: 4 + Math.random() * 10 });
        }
        for (const tr of tracers) {
          tr.x += tr.vx * dt;
          tr.y += tr.vy * dt;
          tr.life -= dt;
        }
        for (const f of flashes) f.life -= dt;
      }
      for (const tr of tracers) {
        if (tr.life <= 0) continue;
        ctx.strokeStyle = tr.amber ? `rgba(255, 159, 64, ${0.35 * tr.life})` : `rgba(110, 170, 255, ${0.35 * tr.life})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(tr.x, tr.y);
        ctx.lineTo(tr.x - tr.vx * 0.03, tr.y - tr.vy * 0.03);
        ctx.stroke();
      }
      for (const f of flashes) {
        if (f.life <= 0) continue;
        const k = f.life / 0.6;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.size * (2 - k) * 2);
        g.addColorStop(0, `rgba(255, 210, 150, ${0.5 * k})`);
        g.addColorStop(1, 'rgba(255, 120, 40, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * (2 - k) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = tracers.length - 1; i >= 0; i--) if (tracers[i].life <= 0) tracers.splice(i, 1);
      for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].life <= 0) flashes.splice(i, 1);

      // Dogfights: a pair of friendly fighters chased across the sky, trading fire
      if (!still) {
        nextWing -= dt;
        if (nextWing <= 0) {
          nextWing = 4 + Math.random() * 5;
          const fromLeft = Math.random() < 0.5;
          const dir = fromLeft ? 1 : -1;
          const y0 = h * (0.12 + Math.random() * 0.4);
          const sp = 90 + Math.random() * 60;
          const vy = (Math.random() - 0.5) * 30;
          const s0 = 0.5 + Math.random() * 0.5;
          for (let k = 0; k < 2; k++) fighters.push({ x: fromLeft ? -40 - k * 26 : w + 40 + k * 26, y: y0 + k * 14, vx: dir * sp, vy, life: (w + 300) / sp, amber: false, s: s0, fireIn: 9 });
          for (let k = 0; k < 2; k++) fighters.push({ x: fromLeft ? -150 - k * 30 : w + 150 + k * 30, y: y0 + 6 + k * 18, vx: dir * sp * 1.04, vy, life: (w + 400) / sp, amber: true, s: s0, fireIn: 0.6 + Math.random() })
        }
        for (const f of fighters) {
          f.x += f.vx * dt;
          f.y += f.vy * dt + Math.sin(t * 2 + f.y) * 0.2;
          f.life -= dt;
          f.fireIn -= dt;
          if (f.amber && f.fireIn <= 0) {
            f.fireIn = 0.5 + Math.random() * 0.8;
            tracers.push({ x: f.x, y: f.y, vx: f.vx * 4, vy: f.vy, life: 0.4, amber: true });
            if (Math.random() < 0.18) blasts.push({ x: f.x + f.vx * 1.4, y: f.y, life: 0.9, size: 10 + Math.random() * 10 });
          }
        }
        for (let i = fighters.length - 1; i >= 0; i--) if (fighters[i].life <= 0) fighters.splice(i, 1);
        if (Math.random() < dt * 0.12) blasts.push({ x: w * (0.2 + Math.random() * 0.75), y: h * (0.06 + Math.random() * 0.4), life: 0.9, size: 12 + Math.random() * 18 });
        for (const bl of blasts) bl.life -= dt;
        for (let i = blasts.length - 1; i >= 0; i--) if (blasts[i].life <= 0) blasts.splice(i, 1);
      }
      for (const f of fighters) {
        const dir = Math.sign(f.vx);
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale(dir * f.s, f.s);
        ctx.globalAlpha = 0.75;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = f.amber ? 'rgba(255, 150, 60, 0.7)' : 'rgba(110, 170, 255, 0.8)';
        ctx.beginPath();
        ctx.moveTo(-5, -1.5);
        ctx.lineTo(-16 - Math.random() * 3, 0);
        ctx.lineTo(-5, 1.5);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = f.amber ? '#2a2420' : '#222b3f';
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-5, -5);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = f.amber ? 'rgba(255, 159, 64, 0.5)' : 'rgba(140, 190, 255, 0.5)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
      }
      for (const bl of blasts) {
        const k = bl.life / 0.9;
        const r = bl.size * (1.6 - k);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, r * 2);
        g.addColorStop(0, `rgba(255, 230, 190, ${0.7 * k})`);
        g.addColorStop(0.3, `rgba(255, 150, 60, ${0.4 * k})`);
        g.addColorStop(1, 'rgba(255, 100, 40, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, r * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 190, 130, ${0.35 * k})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, bl.size * (3 - 2 * k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }

      // Asteroids and wreckage, lit from the upper right
      for (const r of rocks) {
        const x = (((r.x * w - t * 14 * r.z) % (w + 80)) + w + 80) % (w + 80) - 40;
        const y = r.y * h + Math.sin(t * 0.3 + r.rot) * 6;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r.rot + t * r.spin);
        ctx.globalAlpha = 0.35 + r.z * 0.5;
        ctx.beginPath();
        if (r.wreck) {
          // A torn hull plate
          ctx.moveTo(-r.r, -r.r * 0.3);
          ctx.lineTo(r.r * 0.6, -r.r * 0.5);
          ctx.lineTo(r.r, r.r * 0.1);
          ctx.lineTo(r.r * 0.2, r.r * 0.2);
          ctx.lineTo(-r.r * 0.4, r.r * 0.45);
        } else {
          r.verts.forEach((v, k) => {
            const a = (k / r.verts.length) * Math.PI * 2;
            if (k === 0) ctx.moveTo(Math.cos(a) * r.r * v, Math.sin(a) * r.r * v);
            else ctx.lineTo(Math.cos(a) * r.r * v, Math.sin(a) * r.r * v);
          });
        }
        ctx.closePath();
        ctx.fillStyle = r.wreck ? '#1a2030' : '#15171f';
        ctx.fill();
        ctx.strokeStyle = r.wreck ? 'rgba(140, 160, 200, 0.35)' : 'rgba(255, 170, 110, 0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // The hero ship (home screen only; it fades out behind menus)
      heroFade.current = still ? (heroRef.current ? 1 : 0) : Math.max(0, Math.min(1, heroFade.current + (heroRef.current ? 0.05 : -0.08)));
      const pose = shipPose();
      const bob = still ? 0 : Math.sin(t * 0.9) * 6;
      const ang = -0.5 + (still ? 0 : Math.sin(t * 0.5) * 0.03);
      const fade = pose.alpha * heroFade.current;
      if (fade > 0.01) {
        // Escorts flying high and far off (wide screens only), clear of the menu
        if (w >= 900) {
          const wb = still ? 0 : Math.sin(t * 0.8 + 1.3) * 5;
          drawHero(ctx, HULLS.arrow, w * 0.68, h * 0.07 + wb, ang, pose.scale * 0.26, fade * 0.65, t + 0.4, still);
          drawHero(ctx, HULLS.interceptor, w * 0.96, h * 0.34 - wb, ang, pose.scale * 0.2, fade * 0.55, t + 1.1, still);
        }
        drawHero(ctx, HULLS[shipRef.current] ?? HULLS.arrow, pose.x, pose.y + bob, ang, pose.scale, fade, t, still);
      }

      // Occasional blaster volley from the ship
      if (!still) {
        nextVolley -= dt;
        if (nextVolley <= 0) {
          nextVolley = 2.5 + Math.random() * 3;
          for (let k = 0; k < 3; k++) bolts.push({ x: 0, y: 0, life: 1 + k * 0.12 });
        }
        for (const b of bolts) b.life -= dt;
        for (let i = bolts.length - 1; i >= 0; i--) if (bolts[i].life <= 0) bolts.splice(i, 1);
        for (const b of bolts) {
          if (b.life > 1) continue;
          const d = (1 - b.life) * Math.max(w, h) * 0.9;
          const bx = pose.x + Math.cos(ang) * (26 * pose.scale + d);
          const by = pose.y + bob + Math.sin(ang) * (26 * pose.scale + d);
          ctx.strokeStyle = `rgba(140, 195, 255, ${0.9 * b.life * heroFade.current})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - Math.cos(ang) * 22, by - Math.sin(ang) * 22);
          ctx.stroke();
        }
      }

      // A faint vignette keeps text readable over the scene
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [still, still && hero]);

  return <canvas ref={ref} className="lobby-bg" aria-hidden="true" />;
}

/** A detailed spacecraft: engine exhaust with bloom, layered gunmetal hull, rim light, canopy and navigation lights. */
function drawHero(ctx: CanvasRenderingContext2D, pts: [number, number][], x: number, y: number, ang: number, scale: number, alpha: number, t: number, still: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  // Engine exhaust: twin flames, a hot core and a soft bloom
  ctx.globalCompositeOperation = 'lighter';
  for (const off of [-5, 5]) {
    const len = 30 + (still ? 0 : Math.sin(t * 37 + off) * 4 + Math.random() * 3);
    const fg = ctx.createLinearGradient(-12, 0, -12 - len, 0);
    fg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    fg.addColorStop(0.25, 'rgba(120, 180, 255, 0.9)');
    fg.addColorStop(1, 'rgba(40, 90, 255, 0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-11, off - 3);
    ctx.lineTo(-12 - len, off * 0.6);
    ctx.lineTo(-11, off + 3);
    ctx.closePath();
    ctx.fill();
    const bl = ctx.createRadialGradient(-12, off, 0, -12, off, 14);
    bl.addColorStop(0, 'rgba(150, 200, 255, 0.55)');
    bl.addColorStop(1, 'rgba(60, 120, 255, 0)');
    ctx.fillStyle = bl;
    ctx.beginPath();
    ctx.arc(-12, off, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  // Engine nacelles
  ctx.fillStyle = '#1a2133';
  ctx.fillRect(-13, -8, 9, 6);
  ctx.fillRect(-13, 2, 9, 6);
  // Hull: gunmetal, lit from above
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  const hg = ctx.createLinearGradient(0, -22, 0, 22);
  hg.addColorStop(0, '#5d6c8c');
  hg.addColorStop(0.45, '#2a3550');
  hg.addColorStop(1, '#0b101d');
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Upper wing plate (a second, lighter layer) and panel lines
  ctx.fillStyle = 'rgba(150, 175, 220, 0.12)';
  ctx.beginPath();
  ctx.moveTo(20, -1);
  ctx.lineTo(-4, -7);
  ctx.lineTo(-16, -18);
  ctx.lineTo(-10, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.lineTo(22, 0);
  ctx.moveTo(-4, -6);
  ctx.lineTo(-13, -15);
  ctx.moveTo(-4, 6);
  ctx.lineTo(-13, 15);
  ctx.moveTo(-7, -10);
  ctx.lineTo(-7, 10);
  ctx.stroke();
  // Electric-blue squadron stripes
  ctx.strokeStyle = 'rgba(76, 157, 255, 0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-14, -15);
  ctx.lineTo(-6, -9);
  ctx.moveTo(-14, 15);
  ctx.lineTo(-6, 9);
  ctx.stroke();
  ctx.restore();
  // Rim light along the lit edge, cool outline elsewhere
  ctx.strokeStyle = 'rgba(160, 200, 255, 0.45)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(230, 240, 255, 0.8)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  const top = pts.filter(([, py]) => py <= 0).sort((a, b) => b[0] - a[0]);
  top.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.stroke();
  // Cockpit glass
  const cg = ctx.createLinearGradient(2, -3, 12, 3);
  cg.addColorStop(0, '#e6f2ff');
  cg.addColorStop(0.5, '#4c9dff');
  cg.addColorStop(1, '#0d1a36');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.ellipse(6, 0, 7, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Navigation lights: red port, green starboard, white tail strobe (each with a small glow)
  const tip = pts.reduce((acc, p) => (p[1] < acc[1] ? p : acc), pts[0]);
  const lights: [number, number, string, boolean][] = [
    [tip[0], tip[1], '255, 70, 70', still || Math.floor(t * 1.4) % 2 === 0],
    [tip[0], -tip[1], '90, 255, 140', still || Math.floor(t * 1.4) % 2 === 0],
    [-13, 0, '255, 255, 255', still || Math.floor(t * 2.6) % 3 === 0],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const [lx, ly, c, on] of lights) {
    if (!on) continue;
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 5);
    g.addColorStop(0, `rgba(${c}, 0.95)`);
    g.addColorStop(1, `rgba(${c}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
