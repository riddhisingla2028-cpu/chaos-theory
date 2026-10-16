// Shareable score cards: a 1080 x 1350 image drawn on a canvas in the browser. Nothing is uploaded;
// the player chooses where to share it (system share sheet on phones, a download elsewhere).

export interface CardData {
  kicker: string; // e.g. "Level 6 · Double Chaos" or "Orb Rush"
  headline: string; // e.g. "Level complete" or "New best"
  score: number;
  stats: [string, string][]; // up to three label/value pairs
  stars: number | null; // 0-3, or null when the mode has no stars
  accountLevel: number;
  accent: [number, number, number];
}

const W = 1080;
const H = 1350;
const DISPLAY = "'Unbounded', 'Inter', ui-sans-serif, system-ui, sans-serif";
const BODY = "'Inter', ui-sans-serif, system-ui, sans-serif";

export function drawCard(ctx: CanvasRenderingContext2D, d: CardData): void {
  const [r, g, b] = d.accent;
  const acc = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  ctx.fillStyle = '#050507';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, W * 0.75);
  glow.addColorStop(0, acc(0.28));
  glow.addColorStop(1, 'rgba(5, 5, 7, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Perspective grid floor.
  ctx.strokeStyle = acc(0.18);
  ctx.lineWidth = 2;
  for (let i = 0; i <= 12; i++) {
    const y = H * 0.78 + i * i * 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let i = -10; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 40, H * 0.78);
    ctx.lineTo(W / 2 + i * 260, H);
    ctx.stroke();
  }
  ctx.strokeStyle = acc(0.6);
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#F3F0EA';
  ctx.font = `800 64px ${DISPLAY}`;
  ctx.fillText('CHAOS THEORY', W / 2, 170);
  ctx.fillStyle = acc(1);
  ctx.font = `600 34px ${BODY}`;
  ctx.fillText(d.kicker.toUpperCase(), W / 2, 250);
  ctx.fillStyle = '#F3F0EA';
  ctx.font = `700 54px ${DISPLAY}`;
  ctx.fillText(d.headline, W / 2, 380);

  ctx.shadowColor = acc(0.9);
  ctx.shadowBlur = 50;
  ctx.font = `800 200px ${DISPLAY}`;
  ctx.fillText(d.score.toLocaleString(), W / 2, 620);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(243, 240, 234, 0.6)';
  ctx.font = `600 30px ${BODY}`;
  ctx.fillText('SCORE', W / 2, 680);

  if (d.stars !== null) {
    for (let i = 0; i < 3; i++) {
      const cx = W / 2 + (i - 1) * 110;
      star(ctx, cx, 790, 44, i < d.stars ? '#FFD54A' : 'rgba(243, 240, 234, 0.18)');
    }
  }

  const cols = d.stats.slice(0, 3);
  cols.forEach(([label, value], i) => {
    const x = W / 2 + (i - (cols.length - 1) / 2) * 300;
    ctx.fillStyle = '#F3F0EA';
    ctx.font = `700 56px ${DISPLAY}`;
    ctx.fillText(value, x, 960);
    ctx.fillStyle = 'rgba(243, 240, 234, 0.6)';
    ctx.font = `600 26px ${BODY}`;
    ctx.fillText(label.toUpperCase(), x, 1005);
  });

  ctx.fillStyle = 'rgba(243, 240, 234, 0.7)';
  ctx.font = `600 30px ${BODY}`;
  ctx.fillText(`Account level ${d.accountLevel}`, W / 2, 1210);
  ctx.fillStyle = acc(1);
  ctx.font = `600 30px ${BODY}`;
  ctx.fillText('Can you beat it?', W / 2, 1260);
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export async function makeCard(d: CardData): Promise<Blob | null> {
  try {
    await document.fonts?.ready;
  } catch {
    // fonts are optional; system fallbacks are fine
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawCard(ctx, d);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Share the card with the system share sheet when the browser supports sharing files (most phones),
 * otherwise save it as a PNG. Returns what happened, for a short confirmation message.
 */
export async function shareCard(d: CardData, text: string): Promise<'shared' | 'saved' | 'cancelled' | 'failed'> {
  const blob = await makeCard(d);
  if (!blob) return 'failed';
  const file = new File([blob], 'chaos-theory-score.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, title: 'Chaos Theory' });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Sharing is not allowed here (some desktops, embedded browsers): save the image instead.
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chaos-theory-score.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'saved';
  } catch {
    return 'failed';
  }
}
