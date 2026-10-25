import type { FC } from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';

/**
 * A Pokéball drawn in SVG. `openFrame` is the frame (relative to the composition) it starts opening on;
 * before that it sits closed with a gentle bob. The lid swings up on a spring, then the ball fades as the
 * Pokémon appears.
 */
export const Pokeball: FC<{ frame: number; openFrame: number; size: number }> = ({ frame, openFrame, size }) => {
  const { fps } = useVideoConfig();
  const t = frame - openFrame;
  const open = t < 0 ? 0 : spring({ frame: t, fps, config: { damping: 11, mass: 0.7, stiffness: 140 } });
  const bob = t < 0 ? Math.sin(frame / 9) * 5 : 0;
  const fade = interpolate(t, [10, 22], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flash = interpolate(t, [0, 5, 16], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'relative', width: size, height: size, transform: `translateY(${bob}px)`, opacity: fade }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ overflow: 'visible' }}>
        <circle cx="50" cy="50" r="46" fill="#fff" stroke="#1a1a2e" strokeWidth="6" />
        {/* lid: the top half, hinged on its left edge */}
        <g transform={`translate(${open * -6} ${open * -22}) rotate(${open * -62} 8 50)`}>
          <path d="M4 50 A46 46 0 0 1 96 50 Z" fill="#e53935" stroke="#1a1a2e" strokeWidth="6" strokeLinejoin="round" />
          <path d="M18 38 A34 34 0 0 1 40 18" fill="none" stroke="#ff8a80" strokeWidth="5" strokeLinecap="round" />
        </g>
        <rect x="4" y="46" width="92" height="8" fill="#1a1a2e" opacity={1 - open * 0.6} />
        <circle cx="50" cy="50" r="13" fill="#fff" stroke="#1a1a2e" strokeWidth="6" />
        <circle cx="50" cy="50" r="5" fill="#cfd8dc" />
      </svg>
      <div
        style={{
          position: 'absolute', inset: -size * 0.25, borderRadius: '50%', opacity: flash,
          background: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.6) 35%, rgba(255,255,255,0) 70%)',
        }}
      />
    </div>
  );
};
