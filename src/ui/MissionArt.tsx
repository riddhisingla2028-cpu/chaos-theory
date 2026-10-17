import type { ReactNode } from 'react';
import type { MissionId } from '../mission/sim';

// Small illustrated vignettes for the mission cards: one recognisable scene per operation, drawn as
// inline SVG in the game's palette (no image assets, scales cleanly, costs nothing to load).

const HULL = '#2b3448';
const EDGE = '#8fb4ec';
const BLUE = '#4c9dff';
const AMBER = '#ff9f40';
const RED = '#e5484d';
const ALIEN = '#b06eff';

/** The player's fighter, pointing along +x, at (x, y) and rotation r (degrees). */
const Fighter = ({ x, y, r = 0, s = 1 }: { x: number; y: number; r?: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
    <path d="M-7 -1.6 L-17 0 L-7 1.6Z" fill="url(#ma-flame)" />
    <path d="M9 0 L-1 -2.5 L-6 -6.5 L-4.5 -1.4 L-4.5 1.4 L-6 6.5 L-1 2.5Z" fill={HULL} stroke={EDGE} strokeWidth="0.6" />
    <ellipse cx="2" cy="0" rx="2.6" ry="1.2" fill={BLUE} />
  </g>
);

const Rock = ({ x, y, r, k = 0 }: { x: number; y: number; r: number; k?: number }) => {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    const rr = r * (0.78 + 0.22 * Math.abs(Math.sin(i * 2.3 + k)));
    return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`;
  });
  return <polygon points={pts.join(' ')} fill="url(#ma-rock)" stroke="rgba(255,159,64,0.5)" strokeWidth="0.6" />;
};

const Raider = ({ x, y, r = 180 }: { x: number; y: number; r?: number }) => (
  <g transform={`translate(${x} ${y}) rotate(${r})`}>
    <path d="M7 0 Q-1 1.5 -5 6 Q-2 1.5 -3 0 Q-2 -1.5 -5 -6 Q-1 -1.5 7 0Z" fill="#2a1838" stroke={ALIEN} strokeWidth="0.6" />
    <circle cx="1" cy="0" r="1.3" fill={ALIEN} />
  </g>
);

const Hostile = ({ x, y, r = 180, s = 1 }: { x: number; y: number; r?: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
    <path d="M7 0 L1 -1.5 L-1 -5 L-4 -5 L-3 -1.5 L-5 0 L-3 1.5 L-4 5 L-1 5 L1 1.5Z" fill="#30343f" stroke={RED} strokeWidth="0.6" />
  </g>
);

const Ship = ({ x, y, L, W, r = -90, cargo = false }: { x: number; y: number; L: number; W: number; r?: number; cargo?: boolean }) => (
  <g transform={`translate(${x} ${y}) rotate(${r})`}>
    <path d={`M${-L * 0.9} ${-W * 0.25} L${-L * 1.4} 0 L${-L * 0.9} ${W * 0.25}Z`} fill="url(#ma-flame)" />
    {cargo ? (
      <>
        <rect x={-L * 0.9} y={-W / 2} width={L * 1.3} height={W} fill={HULL} stroke={EDGE} strokeWidth="0.5" />
        <rect x={-L * 0.85} y={-W * 0.4} width={L * 0.38} height={W * 0.8} fill="#7a4a2e" />
        <rect x={-L * 0.45} y={-W * 0.4} width={L * 0.38} height={W * 0.8} fill="#46536b" />
        <path d={`M${L * 0.4} ${-W * 0.4} L${L * 0.85} 0 L${L * 0.4} ${W * 0.4}Z`} fill={HULL} stroke={EDGE} strokeWidth="0.5" />
      </>
    ) : (
      <path d={`M${L} 0 L${L * 0.2} ${-W * 0.45} L${-L * 0.9} ${-W * 0.7} L${-L * 0.9} ${W * 0.7} L${L * 0.2} ${W * 0.45}Z`} fill={HULL} stroke={EDGE} strokeWidth="0.6" />
    )}
  </g>
);

const Bolt = ({ x1, y1, x2, y2, c = AMBER }: { x1: number; y1: number; x2: number; y2: number; c?: string }) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth="1.2" strokeLinecap="round" />;

const Stars = ({ seed }: { seed: number }) => (
  <g fill="#dfe8ff">
    {Array.from({ length: 22 }, (_, i) => {
      const x = (i * 53 + seed * 17) % 120;
      const y = (i * 29 + seed * 11) % 72;
      return <rect key={i} x={x} y={y} width={i % 5 ? 0.6 : 1} height={i % 5 ? 0.6 : 1} opacity={0.25 + (i % 4) * 0.15} />;
    })}
  </g>
);

const SCENES: Record<MissionId, { sky: [string, string]; art: ReactNode }> = {
  'first-contact': {
    sky: ['#120e10', '#06070d'],
    art: (
      <>
        <circle cx="104" cy="8" r="20" fill="url(#ma-planet-warm)" />
        <Rock x={28} y={18} r={9} k={1} />
        <Rock x={70} y={46} r={12} k={2} />
        <Rock x={98} y={58} r={7} k={3} />
        <Rock x={14} y={56} r={6} k={4} />
        <circle cx="86" cy="26" r="6" fill="rgba(76,157,255,0.25)" />
        <path d="M86 22 L89 26 L86 30 L83 26Z" fill="#d6ecff" />
        <Fighter x={46} y={34} r={-20} s={1.2} />
      </>
    ),
  },
  'alien-pursuit': {
    sky: ['#140a1c', '#07060e'],
    art: (
      <>
        <Ship x={74} y={36} L={16} W={12} r={-160} />
        <Raider x={26} y={22} r={10} />
        <Raider x={18} y={44} r={-5} />
        <Raider x={36} y={56} r={-20} />
        <Bolt x1={34} y1={24} x2={50} y2={28} c={ALIEN} />
        <Bolt x1={28} y1={44} x2={44} y2={42} c={ALIEN} />
        <Fighter x={60} y={18} r={170} />
        <Bolt x1={52} y1={19} x2={42} y2={21} c={BLUE} />
      </>
    ),
  },
  rescue: {
    sky: ['#081220', '#05080f'],
    art: (
      <>
        <path d="M0 72 Q60 40 120 60 L120 72Z" fill="rgba(140,180,220,0.08)" />
        <path d="M84 50 L104 40 L118 44 L112 54 Z" fill="#1b2232" stroke="#55627d" strokeWidth="0.6" />
        <Fighter x={44} y={36} r={-150} s={1.1} />
        <line x1={40} y1={38} x2={28} y2={44} stroke="#96d2ff" strokeDasharray="1.5 1.5" strokeWidth="0.7" />
        <line x1={28} y1={44} x2={18} y2={52} stroke="#96d2ff" strokeDasharray="1.5 1.5" strokeWidth="0.7" />
        {[
          [28, 44],
          [18, 52],
          [70, 20],
          [92, 26],
        ].map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y} rx="3" ry="4.4" fill="#d9e2f0" stroke={BLUE} strokeWidth="0.5" />
            <circle cx={x} cy={y - 5.5} r="1" fill="#ffd54a" />
          </g>
        ))}
        <circle cx="70" cy="20" r="8" fill="none" stroke="rgba(255,213,74,0.35)" strokeWidth="0.6" />
      </>
    ),
  },
  'shattered-orbit': {
    sky: ['#0b0d18', '#05060b'],
    art: (
      <>
        <circle cx="16" cy="76" r="40" fill="url(#ma-planet-cool)" />
        <path d="M58 8 A26 26 0 0 1 110 30" fill="none" stroke="#3b4458" strokeWidth="5" />
        <path d="M100 52 A26 26 0 0 1 62 58" fill="none" stroke="#3b4458" strokeWidth="5" />
        <rect x="80" y="20" width="3" height="20" fill="#2a3142" transform="rotate(30 81 30)" />
        <circle cx="62" cy="30" r="9" fill="none" stroke="#7d96eb" strokeWidth="1" strokeDasharray="5 3" />
        <Fighter x={44} y={36} r={-15} s={1.1} />
        <rect x="28" y="16" width="10" height="3" fill="#2a3142" transform="rotate(-25 33 17)" />
      </>
    ),
  },
  collapse: {
    sky: ['#1a0a08', '#07050a'],
    art: (
      <>
        <circle cx="60" cy="150" r="96" fill="url(#ma-planet-fire)" />
        <circle cx="60" cy="150" r="98" fill="none" stroke="rgba(255,120,60,0.5)" strokeWidth="2" />
        <g transform="rotate(-12 64 30)">
          <rect x="40" y="26" width="48" height="5" fill="#2a3142" stroke="#5a6378" strokeWidth="0.5" />
          <rect x="60" y="14" width="5" height="30" fill="#2a3142" stroke="#5a6378" strokeWidth="0.5" />
        </g>
        <path d="M30 40 L34 46 M90 44 L86 52 M70 50 L72 58" stroke={AMBER} strokeWidth="1" />
        <Fighter x={24} y={20} r={-35} s={1.1} />
      </>
    ),
  },
  meltdown: {
    sky: ['#161005', '#07060a'],
    art: (
      <>
        <circle cx="60" cy="36" r="30" fill="url(#ma-core)" />
        <circle cx="60" cy="36" r="22" fill="none" stroke="rgba(255,159,64,0.6)" strokeWidth="1.5" strokeDasharray="30 8" />
        <circle cx="60" cy="36" r="31" fill="none" stroke="rgba(255,213,74,0.35)" strokeWidth="3" />
        <polygon points="60,27 68,31.5 68,40.5 60,45 52,40.5 52,31.5" fill="#1d2230" stroke="#ffd54a" strokeWidth="0.8" />
        <circle cx="60" cy="36" r="4" fill="#fff6d8" />
        {[
          [18, 14],
          [102, 16],
          [100, 58],
        ].map(([x, y], i) => (
          <polygon key={i} points={`${x},${y - 6} ${x + 5},${y - 3} ${x + 5},${y + 3} ${x},${y + 6} ${x - 5},${y + 3} ${x - 5},${y - 3}`} fill="rgba(255,213,74,0.12)" stroke="#a88a40" strokeWidth="0.6" />
        ))}
        <Fighter x={22} y={56} r={-40} />
      </>
    ),
  },
  'breach-protocol': {
    sky: ['#170809', '#07050a'],
    art: (
      <>
        <Ship x={60} y={54} L={18} W={14} r={-90} />
        {[
          [20, 12, 40],
          [34, 8, 60],
          [50, 14, 80],
          [70, 10, 100],
          [88, 16, 120],
          [102, 8, 130],
          [16, 30, 20],
          [104, 32, 160],
          [80, 26, 110],
        ].map(([x, y, r], i) => (
          <Hostile key={i} x={x} y={y} r={r} s={0.85} />
        ))}
        <Bolt x1={50} y1={20} x2={56} y2={32} c={AMBER} />
        <Bolt x1={80} y1={30} x2={70} y2={40} c={AMBER} />
        <Fighter x={34} y={44} r={-70} />
      </>
    ),
  },
  convoy: {
    sky: ['#141009', '#06070b'],
    art: (
      <>
        <circle cx="6" cy="18" r="26" fill="url(#ma-planet-sand)" />
        <ellipse cx="6" cy="18" rx="40" ry="7" fill="none" stroke="rgba(190,150,100,0.35)" strokeWidth="1.5" transform="rotate(-15 6 18)" />
        <Ship x={50} y={56} L={9} W={7} r={-60} cargo />
        <Ship x={70} y={38} L={9} W={7} r={-60} cargo />
        <Ship x={90} y={20} L={9} W={7} r={-60} cargo />
        <Hostile x={108} y={50} r={200} />
        <Hostile x={104} y={62} r={210} />
        <Bolt x1={100} y1={50} x2={80} y2={44} />
        <Fighter x={84} y={56} r={-30} />
      </>
    ),
  },
  'last-jump': {
    sky: ['#071026', '#04060d'],
    art: (
      <>
        <circle cx="60" cy="40" r="27" fill="none" stroke="rgba(76,157,255,0.25)" strokeWidth="4" />
        <path d="M60 13 A27 27 0 0 1 86 47" fill="none" stroke={BLUE} strokeWidth="2" />
        <Ship x={60} y={44} L={22} W={16} r={-90} />
        <Hostile x={16} y={14} r={30} />
        <Hostile x={104} y={12} r={140} />
        <Hostile x={108} y={46} r={170} />
        <Bolt x1={22} y1={18} x2={34} y2={26} />
        <Fighter x={28} y={48} r={-60} />
      </>
    ),
  },
  guardian: {
    sky: ['#14060c', '#050308'],
    art: (
      <>
        <ellipse cx="38" cy="24" rx="34" ry="10" fill="none" stroke="rgba(200,110,255,0.4)" strokeWidth="2" transform="rotate(-12 38 24)" />
        <ellipse cx="38" cy="24" rx="24" ry="7" fill="none" stroke="rgba(255,150,120,0.5)" strokeWidth="1.5" transform="rotate(-12 38 24)" />
        <circle cx="38" cy="24" r="8" fill="#000" stroke="rgba(255,159,64,0.7)" strokeWidth="0.8" />
        <g transform="translate(86 42)">
          <polygon points="0,-17 12,-12 17,0 12,12 0,17 -12,12 -17,0 -12,-12" fill="#2a2c36" stroke={RED} strokeWidth="1" />
          <circle r="5" fill={AMBER} />
          <circle r="2" fill="#fff" />
        </g>
        <line x1="86" y1="42" x2="30" y2="70" stroke="rgba(255,159,64,0.45)" strokeWidth="5" />
        <line x1="86" y1="42" x2="30" y2="70" stroke="#ffe7c2" strokeWidth="1" />
        <Fighter x={30} y={50} r={-30} s={1.1} />
      </>
    ),
  },
};

/** A mission's illustrated vignette. Locked missions show a darkened, desaturated scene. */
export function MissionArt({ id, locked = false }: { id: MissionId; locked?: boolean }) {
  const sc = SCENES[id];
  const gid = `ma-sky-${id}`;
  return (
    <svg className={`mission-art${locked ? ' locked' : ''}`} viewBox="0 0 120 72" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sc.sky[0]} />
          <stop offset="1" stopColor={sc.sky[1]} />
        </linearGradient>
        <linearGradient id="ma-flame" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#7fb8ff" />
          <stop offset="1" stopColor="#4c9dff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ma-rock" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#6d625a" />
          <stop offset="0.6" stopColor="#2b2724" />
          <stop offset="1" stopColor="#0d0c0d" />
        </radialGradient>
        <radialGradient id="ma-planet-warm" cx="0.3" cy="0.6" r="0.8">
          <stop offset="0" stopColor="#8c6a4c" />
          <stop offset="1" stopColor="#0c0a0c" />
        </radialGradient>
        <radialGradient id="ma-planet-cool" cx="0.6" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#5f6a8c" />
          <stop offset="1" stopColor="#07080e" />
        </radialGradient>
        <radialGradient id="ma-planet-sand" cx="0.7" cy="0.6" r="0.8">
          <stop offset="0" stopColor="#b08a5a" />
          <stop offset="1" stopColor="#0c0a08" />
        </radialGradient>
        <radialGradient id="ma-planet-fire" cx="0.5" cy="0.1" r="0.6">
          <stop offset="0" stopColor="#d06a38" />
          <stop offset="0.5" stopColor="#5a2414" />
          <stop offset="1" stopColor="#140806" />
        </radialGradient>
        <radialGradient id="ma-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff2c8" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#ffb040" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff9f40" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="72" fill={`url(#${gid})`} />
      <Stars seed={sc.sky[0].length + id.length} />
      {sc.art}
    </svg>
  );
}
