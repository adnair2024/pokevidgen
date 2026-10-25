/** Duration in milliseconds of a PCM WAV file, read from its header. */
export const wavDurationMs = (bytes: Uint8Array): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'fmt ') byteRate = view.getUint32(at + 16, true);
    if (tag(at) === 'data') {
      if (!byteRate) throw new Error('WAV data before fmt chunk');
      return Math.round((size / byteRate) * 1000);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
};
