import type { ShapeId } from '../progress';

/** Polygon points for a player shape of "radius" r, centred on 0,0. Returns null for a circle. */
export function shapePoints(shape: ShapeId, r: number): Array<[number, number]> | null {
  const ring = (n: number, radius: number, start: number) =>
    Array.from({ length: n }, (_, i): [number, number] => {
      const a = start + (i / n) * Math.PI * 2;
      return [Math.cos(a) * radius, Math.sin(a) * radius];
    });
  switch (shape) {
    case 'square':
      return [[-r, -r], [r, -r], [r, r], [-r, r]];
    case 'diamond':
      return ring(4, r * 1.3, -Math.PI / 2);
    case 'triangle':
      return ring(3, r * 1.4, -Math.PI / 2);
    case 'hexagon':
      return ring(6, r * 1.15, 0);
    case 'star':
      return Array.from({ length: 10 }, (_, i): [number, number] => {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const radius = i % 2 === 0 ? r * 1.45 : r * 0.62;
        return [Math.cos(a) * radius, Math.sin(a) * radius];
      });
    case 'nova':
      return Array.from({ length: 16 }, (_, i): [number, number] => {
        const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
        const radius = i % 2 === 0 ? r * 1.5 : r * 0.75;
        return [Math.cos(a) * radius, Math.sin(a) * radius];
      });
    case 'spark':
      return Array.from({ length: 8 }, (_, i): [number, number] => {
        const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
        const radius = i % 2 === 0 ? r * 1.6 : r * 0.45;
        return [Math.cos(a) * radius, Math.sin(a) * radius];
      });
    case 'circle':
      return null;
  }
}

/** SVG path data for previews in menus. */
export function shapeSvgPath(shape: ShapeId, r: number): string {
  const pts = shapePoints(shape, r);
  if (!pts) return `M ${r * 1.1} 0 A ${r * 1.1} ${r * 1.1} 0 1 1 ${-r * 1.1} 0 A ${r * 1.1} ${r * 1.1} 0 1 1 ${r * 1.1} 0 Z`;
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + ' Z';
}
