import { Composition } from 'remotion';
import { DraftVideo, type DraftVideoProps } from './DraftVideo.js';
import { SAMPLE_RUN } from './fixtures.js';
import { HEIGHT, FPS, WIDTH } from './theme.js';
import { buildTimeline } from './timeline.js';

export const COMPOSITION_ID = 'DraftRun';

const defaultProps: DraftVideoProps = { run: SAMPLE_RUN };

export const Root = () => (
  <Composition
    id={COMPOSITION_ID}
    component={DraftVideo}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    defaultProps={defaultProps}
    // Duration is derived from the timeline (a pure function of the run and any voice manifest), never hardcoded.
    durationInFrames={buildTimeline(SAMPLE_RUN, FPS).durationInFrames}
    calculateMetadata={({ props }) => ({ durationInFrames: buildTimeline(props.run, FPS, props.manifest).durationInFrames })}
  />
);
