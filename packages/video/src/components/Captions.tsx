import type { FC } from 'react';
import { captionAt } from '../captions.js';
import { LAYOUT, TEXT } from '../theme.js';
import type { WordFrames } from '../timeline.js';
import { PIXEL_FONT } from './font.js';

/** Word-by-word captions: 2-4 words at a time, the spoken word highlighted. Shows the script's own words. */
export const Captions: FC<{ words: WordFrames[]; frame: number }> = ({ words, frame }) => {
  const at = captionAt(words, frame);
  if (!at) return null;
  const length = at.chunk.map((w) => w.word).join(' ').length;
  const size = length > 26 ? 28 : length > 20 ? 32 : 36;
  return (
    <div style={{ position: 'absolute', left: LAYOUT.margin, width: 1080 - 2 * LAYOUT.margin, top: LAYOUT.captionsTop, height: LAYOUT.captionsBottom - LAYOUT.captionsTop, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ fontFamily: PIXEL_FONT, fontSize: size, lineHeight: 1.6, textShadow: '4px 4px 0 rgba(0,0,0,0.75)' }}>
        {at.chunk.map((w, i) => (
          <span key={i} style={{ color: i === at.active ? TEXT.captionHighlight : TEXT.caption }}>{w.word}{i < at.chunk.length - 1 ? ' ' : ''}</span>
        ))}
      </div>
    </div>
  );
};
