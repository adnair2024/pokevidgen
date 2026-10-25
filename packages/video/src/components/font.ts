import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

export const PIXEL_FONT = '"PressStart2P", monospace';

/**
 * Loads the pixel font before the first frame is rendered, so no frame ever shows a fallback font.
 * The font file is copied into public/fonts by the render step and read through staticFile().
 */
export const usePixelFont = (): void => {
  const [handle] = useState(() => delayRender('Loading pixel font'));
  useEffect(() => {
    const face = new FontFace('PressStart2P', `url(${staticFile('fonts/press-start-2p.woff2')})`);
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        continueRender(handle);
      })
      .catch((err) => {
        console.error('Could not load the pixel font', err);
        continueRender(handle);
      });
  }, [handle]);
};
