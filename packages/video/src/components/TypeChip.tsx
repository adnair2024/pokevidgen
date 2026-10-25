import type { CSSProperties, FC } from 'react';
import { TEXT, TYPE_COLORS } from '../theme.js';
import { PIXEL_FONT } from './font.js';

export const TypeChip: FC<{ type: string; size?: number }> = ({ type, size = 18 }) => {
  const style: CSSProperties = {
    display: 'inline-block',
    background: TYPE_COLORS[type] ?? '#888',
    color: TEXT.light,
    fontFamily: PIXEL_FONT,
    fontSize: size,
    textTransform: 'uppercase',
    padding: `${size * 0.4}px ${size * 0.7}px`,
    borderRadius: size * 0.5,
    border: '3px solid rgba(0,0,0,0.35)',
    textShadow: '2px 2px 0 rgba(0,0,0,0.4)',
    margin: '0 6px',
  };
  return <span style={style}>{type}</span>;
};
