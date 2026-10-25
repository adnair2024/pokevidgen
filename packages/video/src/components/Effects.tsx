import type { FC, ReactNode } from 'react';
import { interpolate, random } from 'remotion';

/** How many frames an effect lasts after the ball opens. */
export const EFFECT_FRAMES = 36;

const particles = (key: string, n: number) => Array.from({ length: n }, (_, i) => ({ a: random(`${key}-a-${i}`), b: random(`${key}-b-${i}`), c: random(`${key}-c-${i}`) }));

const Box: FC<{ w: number; h: number; children: ReactNode }> = ({ w, h, children }) => (
  <div style={{ position: 'absolute', left: -40, top: -40, width: w + 80, height: h + 80, pointerEvents: 'none', overflow: 'hidden' }}>{children}</div>
);

/**
 * Overlay effects for a slot, driven only by `t` (frames since the ball opened) and seeded `random()`,
 * so every render is identical. Effects: lightning, flames, bubbles, leaves, snow, psychic.
 */
export const Effect: FC<{ kind: string; t: number; w: number; h: number; seed: string }> = ({ kind, t, w, h, seed }) => {
  if (t < 0 || t > EFFECT_FRAMES) return null;
  const life = t / EFFECT_FRAMES;
  const ps = particles(seed, 22);

  switch (kind) {
    case 'lightning': {
      const flash = [0, 3, 6, 10, 13].some((f) => Math.abs(t - f) < 1.5) ? 0.7 : 0;
      const bolt = 'M60 0 L40 90 L70 90 L35 210 L110 80 L78 80 L100 0 Z';
      return (
        <Box w={w} h={h}>
          <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: flash }} />
          {[0.18, 0.62].map((x, i) => (
            <svg key={i} viewBox="0 0 140 220" width={150} height={236} style={{ position: 'absolute', left: 40 + x * w - 60, top: 20, opacity: interpolate(t, [i * 3, i * 3 + 2, 14 + i * 3, 18 + i * 3], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
              <path d={bolt} fill="#ffe94a" stroke="#fff7b0" strokeWidth="5" strokeLinejoin="round" />
            </svg>
          ))}
        </Box>
      );
    }
    case 'flames':
      return (
        <Box w={w} h={h}>
          {ps.map((p, i) => {
            const y = h + 40 - life * (h * (0.7 + p.b * 0.5)) - p.c * 40;
            const size = 26 + p.a * 40;
            return <div key={i} style={{ position: 'absolute', left: 40 + p.a * w, top: y, width: size, height: size * 1.3, borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%', background: i % 3 ? '#ff8a1c' : '#ffd23f', opacity: 1 - life, transform: `scale(${1 - life * 0.5})` }} />;
          })}
        </Box>
      );
    case 'bubbles':
      return (
        <Box w={w} h={h}>
          {ps.map((p, i) => {
            const size = 18 + p.b * 44;
            return <div key={i} style={{ position: 'absolute', left: 40 + p.a * w + Math.sin(t / 4 + i) * 10, top: h + 40 - life * (h * (0.6 + p.c * 0.6)), width: size, height: size, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.85)', background: 'rgba(120,180,255,0.35)', opacity: 1 - life * 0.7 }} />;
          })}
        </Box>
      );
    case 'leaves':
      return (
        <Box w={w} h={h}>
          {ps.map((p, i) => (
            <div key={i} style={{ position: 'absolute', left: 40 + p.a * w + Math.sin(t / 3 + i) * 24, top: 20 + life * (h * (0.5 + p.b * 0.6)), width: 26, height: 14, borderRadius: '0 100% 0 100%', background: i % 2 ? '#5fbf3d' : '#8ddc5a', transform: `rotate(${t * (6 + p.c * 8) + i * 40}deg)`, opacity: 1 - life * 0.6 }} />
          ))}
        </Box>
      );
    case 'snow':
      return (
        <Box w={w} h={h}>
          {ps.map((p, i) => (
            <div key={i} style={{ position: 'absolute', left: 40 + p.a * w + Math.sin(t / 5 + i) * 12, top: -10 + life * (h + 60) * (0.7 + p.b * 0.5), width: 12 + p.c * 14, height: 12 + p.c * 14, borderRadius: '50%', background: '#fff', opacity: 0.9 - life * 0.3 }} />
          ))}
        </Box>
      );
    case 'psychic':
      return (
        <Box w={w} h={h}>
          {[0, 8, 16].map((d, i) => {
            const r = interpolate(t - d, [0, 24], [30, w * 0.7], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return <div key={i} style={{ position: 'absolute', left: 40 + w / 2 - r, top: 40 + h / 2 - r, width: r * 2, height: r * 2, borderRadius: '50%', border: '8px solid #ff6fa5', opacity: interpolate(t - d, [0, 24], [0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />;
          })}
        </Box>
      );
    default:
      return null;
  }
};
