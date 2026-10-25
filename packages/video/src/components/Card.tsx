import type { CSSProperties, FC, ReactNode } from 'react';
import { Img, interpolate, spring, staticFile, useVideoConfig } from 'remotion';
import type { Pick } from '../run.js';
import { CARD_COLORS, DEFAULT_TIMING, TEXT, TYPE_COLORS } from '../theme.js';
import { PIXEL_FONT } from './font.js';
import { TypeChip } from './TypeChip.js';

const CARD_W = 820;
const CARD_X = (1080 - CARD_W) / 2;
const CARD_Y = 330;

const Frame: FC<{ kind: keyof typeof CARD_COLORS; label: string; children: ReactNode }> = ({ kind, label, children }) => {
  const c = CARD_COLORS[kind];
  const outer: CSSProperties = {
    width: CARD_W, background: c.header, border: `14px solid ${c.border}`, borderRadius: 44, overflow: 'hidden',
    boxShadow: '0 24px 0 rgba(0,0,0,0.35)',
  };
  return (
    <div style={outer}>
      <div style={{ fontFamily: PIXEL_FONT, fontSize: 30, color: TEXT.light, padding: '22px 30px', textShadow: `4px 4px 0 ${c.border}`, letterSpacing: 2 }}>{label}</div>
      <div style={{ background: '#fffdf4', margin: '0 18px 18px', borderRadius: 26, border: `6px solid ${c.border}`, padding: '36px 34px', minHeight: 640, color: TEXT.dark, fontFamily: PIXEL_FONT, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
};

const Emblem: FC<{ letter: string; types: string[] }> = ({ letter, types }) => {
  const a = TYPE_COLORS[types[0] ?? 'normal'] ?? '#888';
  const b = TYPE_COLORS[types[1] ?? types[0] ?? 'normal'] ?? a;
  return (
    <div style={{ width: 240, height: 240, margin: '0 auto 28px', borderRadius: 36, border: '10px solid #1a1a2e', background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: PIXEL_FONT, fontSize: 130, color: TEXT.light, textShadow: '8px 8px 0 rgba(0,0,0,0.45)' }}>{letter}</span>
    </div>
  );
};

const center: CSSProperties = { textAlign: 'center' };

export const CardBody: FC<{ pick: Pick }> = ({ pick }) => {
  const intro = pick.intro;
  if (intro.kind === 'gymLeader') {
    return (
      <Frame kind="gymLeader" label={intro.title.toUpperCase() === 'RIVAL' ? 'RIVAL' : intro.title.includes('Badge') ? 'GYM LEADER' : intro.title.toUpperCase()}>
        <div style={center}>
          <Emblem letter={intro.name.replace(/^(Lt\.\s*)/, '')[0]!.toUpperCase()} types={intro.types} />
          <div style={{ fontSize: 52, lineHeight: 1.3 }}>{intro.name.toUpperCase()}</div>
          <div style={{ fontSize: 24, color: TEXT.muted, margin: '18px 0 26px', lineHeight: 1.6 }}>{intro.title}</div>
          <div>{intro.types.map((t) => <TypeChip type={t} size={22} />)}</div>
        </div>
      </Frame>
    );
  }
  if (intro.kind === 'tm') {
    return (
      <Frame kind="tm" label={`TM${String(intro.number).padStart(2, '0')}`}>
        <div style={center}>
          <div style={{ width: 230, height: 190, margin: '0 auto 30px', borderRadius: 26, background: TYPE_COLORS[intro.moveType] ?? '#888', border: '10px solid #1a1a2e', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 30, right: 30, top: 28, height: 70, borderRadius: 10, background: '#f4f4f4', border: '6px solid #1a1a2e' }} />
            <div style={{ position: 'absolute', left: 80, top: 118, width: 70, height: 36, borderRadius: 18, background: '#1a1a2e' }} />
          </div>
          <div style={{ fontSize: 46, lineHeight: 1.4 }}>{intro.moveName.toUpperCase()}</div>
          <div style={{ margin: '24px 0' }}><TypeChip type={intro.moveType} size={22} /></div>
          <div style={{ fontSize: 22, color: TEXT.muted, lineHeight: 1.7 }}>{intro.location}</div>
        </div>
      </Frame>
    );
  }
  return (
    <Frame kind="pokedex" label="POKÉDEX">
      <div style={center}>
        <div style={{ fontSize: 26, color: TEXT.muted }}>No. {String(pick.dex).padStart(3, '0')}</div>
        <Img src={staticFile(`sprites/${pick.dex}.png`)} style={{ width: 56 * 5, height: 56 * 5, imageRendering: 'pixelated', margin: '10px 0' }} />
        <div style={{ fontSize: 46, lineHeight: 1.3 }}>{pick.name.toUpperCase()}</div>
        {intro.genus && <div style={{ fontSize: 22, color: TEXT.muted, margin: '14px 0', lineHeight: 1.6 }}>{intro.genus}</div>}
        {intro.heightM !== undefined && intro.weightKg !== undefined && (
          <div style={{ fontSize: 22, lineHeight: 1.8 }}>HT {intro.heightM.toFixed(1)} m &nbsp; WT {intro.weightKg.toFixed(1)} kg</div>
        )}
        <div style={{ marginTop: 16 }}>{pick.types.map((t) => <TypeChip type={t} size={22} />)}</div>
      </div>
    </Frame>
  );
};

/**
 * The card pops in with a spring (slight overshoot), holds, then leaves. `cardIn` and `cardOut` are
 * absolute frames from the timeline; the exit lasts `DEFAULT_TIMING.cardOut` seconds.
 */
export const Card: FC<{ pick: Pick; frame: number; cardIn: number; cardOut: number }> = ({ pick, frame, cardIn, cardOut }) => {
  const { fps } = useVideoConfig();
  const exitFrames = Math.round(DEFAULT_TIMING.cardOut * fps);
  if (frame < cardIn || frame > cardOut + exitFrames) return null;
  const enter = spring({ frame: frame - cardIn, fps, config: { damping: 10, mass: 0.7, stiffness: 130 } });
  const leave = interpolate(frame, [cardOut, cardOut + exitFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = (0.55 + 0.45 * enter) * (1 - leave * 0.18);
  const opacity = Math.min(1, enter * 1.6) * (1 - leave);
  return (
    <div style={{ position: 'absolute', left: CARD_X, top: CARD_Y, transform: `translateY(${(1 - enter) * 90 - leave * 70}px) scale(${scale})`, transformOrigin: '50% 50%', opacity }}>
      <CardBody pick={pick} />
    </div>
  );
};
