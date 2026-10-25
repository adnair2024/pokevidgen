import type { FC } from 'react';
import { Img, interpolate, spring, staticFile, useVideoConfig } from 'remotion';
import type { Pick } from '../run.js';
import { LAYOUT, TEXT } from '../theme.js';
import { PIXEL_FONT } from './font.js';
import { Pokeball } from './Pokeball.js';
import { TypeChip } from './TypeChip.js';

/** Top-left corner of slot `index` (two columns, three rows). */
export const slotPosition = (index: number): { x: number; y: number } => ({
  x: LAYOUT.margin + (index % 2) * (LAYOUT.slotW + LAYOUT.gap),
  y: LAYOUT.gridTop + Math.floor(index / 2) * (LAYOUT.slotH + LAYOUT.gap),
});

export const Slot: FC<{ index: number; frame: number; pick?: Pick; ballOpen?: number; plateIn?: number }> = ({ index, frame, pick, ballOpen, plateIn }) => {
  const { fps } = useVideoConfig();
  const { x, y } = slotPosition(index);
  const revealed = pick !== undefined && ballOpen !== undefined && frame >= ballOpen;
  const spriteSize = LAYOUT.spriteSize * LAYOUT.spriteScale;

  // The sprite pops in just after the lid opens, with a little overshoot.
  const pop = revealed ? spring({ frame: frame - ballOpen! - 4, fps, config: { damping: 9, mass: 0.6, stiffness: 150 } }) : 0;
  const plate = plateIn !== undefined ? interpolate(frame, [plateIn, plateIn + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;

  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: LAYOUT.slotW, height: LAYOUT.slotH, borderRadius: 36,
        background: 'rgba(255,255,255,0.14)', border: '6px solid rgba(255,255,255,0.35)', overflow: 'visible',
      }}
    >
      <div style={{ position: 'absolute', left: 20, top: 14, fontFamily: PIXEL_FONT, fontSize: 28, color: 'rgba(255,255,255,0.7)' }}>{index + 1}</div>
      {pick && ballOpen !== undefined && frame < ballOpen + 24 && (
        <div style={{ position: 'absolute', left: (LAYOUT.slotW - 190) / 2, top: 70, }}>
          <Pokeball frame={frame} openFrame={ballOpen} size={190} />
        </div>
      )}
      {!pick && (
        <div style={{ position: 'absolute', left: (LAYOUT.slotW - 190) / 2, top: 70 }}>
          <Pokeball frame={frame} openFrame={Number.MAX_SAFE_INTEGER} size={190} />
        </div>
      )}
      {revealed && pick && (
        <>
          <Img
            src={staticFile(`sprites/${pick.dex}.png`)}
            style={{
              position: 'absolute', left: (LAYOUT.slotW - spriteSize) / 2, top: 18, width: spriteSize, height: spriteSize,
              imageRendering: 'pixelated', transform: `scale(${pop})`, transformOrigin: '50% 80%',
            }}
          />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, textAlign: 'center', opacity: plate, transform: `translateY(${(1 - plate) * 16}px)` }}>
            <div style={{ fontFamily: PIXEL_FONT, fontSize: 28, color: TEXT.light, textShadow: '3px 3px 0 rgba(0,0,0,0.55)', marginBottom: 10 }}>
              {pick.name.toUpperCase()}
            </div>
            <div>{pick.types.map((t) => <TypeChip type={t} size={15} />)}</div>
          </div>
        </>
      )}
    </div>
  );
};
