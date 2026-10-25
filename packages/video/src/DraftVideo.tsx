import { useMemo, type FC } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, interpolateColors, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { duckVolume } from './audio.js';
import { backgroundKeyframes } from './background.js';
import { estimateWords } from './captions.js';
import { Captions } from './components/Captions.js';
import { Card } from './components/Card.js';
import { EFFECT_FRAMES, Effect } from './components/Effects.js';
import { PIXEL_FONT, usePixelFont } from './components/font.js';
import { Slot, slotPosition } from './components/Slot.js';
import type { Manifest, Run } from './run.js';
import { DEFAULT_TIMING, LAYOUT, TEXT } from './theme.js';
import { buildTimeline, type WordFrames } from './timeline.js';

export type DraftVideoProps = { run: Run; manifest?: Manifest };

/** The draft-run short: a 6-slot Pokéball grid that fills one pick at a time, with cards between reveals. */
export const DraftVideo: FC<DraftVideoProps> = ({ run, manifest }) => {
  usePixelFont();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline = useMemo(() => buildTimeline(run, fps, manifest), [run, fps, manifest]);
  const keyframes = useMemo(() => backgroundKeyframes(timeline, run), [timeline, run]);
  const exitFrames = Math.round(DEFAULT_TIMING.cardOut * fps);

  // Caption words: real timings from the voice manifest if there is one, otherwise estimated.
  const captionTracks = useMemo(() => {
    const tracks: Array<{ words: WordFrames[]; start: number; end: number }> = [];
    tracks.push({ words: timeline.hook.voice?.words ?? estimateWords(run.voiceover.hook, timeline.hook.start, timeline.hook.end), start: timeline.hook.start, end: timeline.hook.end });
    for (const b of timeline.beats) {
      const text = run.picks[b.index]!.line.text;
      const end = b.cardIn + Math.round((b.end - b.cardIn) * 0.8);
      tracks.push({ words: b.voice?.words ?? estimateWords(text, b.cardIn, end), start: b.start, end: b.end });
    }
    tracks.push({ words: timeline.outro.voice?.words ?? estimateWords(run.voiceover.outro, timeline.outro.start, timeline.outro.end), start: timeline.outro.start, end: timeline.outro.end });
    return tracks;
  }, [timeline, run]);
  const active = captionTracks.find((t) => frame >= t.start && frame <= t.end);

  const background = interpolateColors(frame, keyframes.frames, keyframes.colors);

  // The grid dims and blurs while a card is up.
  const dim = Math.max(
    0,
    ...timeline.beats.map((b) => interpolate(frame, [b.cardIn - 6, b.cardIn + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * (1 - interpolate(frame, [b.cardOut, b.cardOut + exitFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))),
  );

  const voiceWindows = [timeline.hook, ...timeline.beats, timeline.outro].flatMap((l) => ('voice' in l && l.voice ? [{ startFrame: l.voice.startFrame, endFrame: l.voice.endFrame }] : []));

  return (
    <AbsoluteFill style={{ background, fontFamily: PIXEL_FONT }}>
      <div style={{ position: 'absolute', top: LAYOUT.titleTop, left: 0, right: 0, textAlign: 'center', fontSize: 34, color: TEXT.light, textShadow: '4px 4px 0 rgba(0,0,0,0.5)', fontFamily: PIXEL_FONT }}>
        {run.title.toUpperCase()}
      </div>

      <div style={{ position: 'absolute', inset: 0, filter: `blur(${dim * 10}px) brightness(${1 - dim * 0.5})` }}>
        {run.picks.map((pick, i) => (
          <Slot key={pick.pokemon} index={i} frame={frame} pick={pick} ballOpen={timeline.beats[i]!.ballOpen} plateIn={timeline.beats[i]!.plateIn} />
        ))}
      </div>

      {timeline.beats.map((b) => {
        const pick = run.picks[b.index]!;
        const t = frame - b.ballOpen;
        const { x, y } = slotPosition(b.index);
        return pick.effect && t >= 0 && t <= EFFECT_FRAMES ? (
          <div key={`fx-${pick.pokemon}`} style={{ position: 'absolute', left: x, top: y }}>
            <Effect kind={pick.effect} t={t} w={LAYOUT.slotW} h={LAYOUT.slotH} seed={`${run.id}-${pick.pokemon}`} />
          </div>
        ) : null;
      })}

      {timeline.beats.map((b) => (
        <Card key={`card-${run.picks[b.index]!.pokemon}`} pick={run.picks[b.index]!} frame={frame} cardIn={b.cardIn} cardOut={b.cardOut} />
      ))}

      {active && <Captions words={active.words} frame={frame} />}

      {manifest && [timeline.hook, ...timeline.beats, timeline.outro].map((l) =>
        'voice' in l && l.voice ? (
          <Sequence key={l.voice.key} from={l.voice.startFrame} durationInFrames={l.voice.endFrame - l.voice.startFrame + 2}>
            <Audio src={staticFile(l.voice.file)} />
          </Sequence>
        ) : null,
      )}
      {run.music && <Audio src={staticFile(run.music)} loop volume={(f) => 0.6 * duckVolume(f, fps, voiceWindows)} />}
    </AbsoluteFill>
  );
};
