import type { RunState } from '../lib/types';
import { RUN_STATE_LABELS } from '../lib/types';

const GLYPHS: Record<RunState, string> = {
  success: 'M4.6 8.2 L6.9 10.6 L11.4 5.6',
  failure: 'M5.6 5.6 L10.4 10.4 M10.4 5.6 L5.6 10.4',
  cancelled: 'M4.8 8 H11.2',
  running: 'M8 4.6 V8 L10.4 9.6',
  queued: 'M8 4.6 V8 L10.4 9.6',
  skipped: 'M5.4 5.6 L8 8 L5.4 10.4 M10.6 5.4 V10.6',
  neutral: 'M4.8 8 H11.2',
  unknown: 'M8 4.8 V8.6 M8 10.8 V11',
};

export interface IStatusIconProps {
  state: RunState;
  size?: number;
}

/**
 * A small circular status badge, coloured per run state.
 */
export function StatusIcon({ state, size = 14 }: IStatusIconProps) {
  return (
    <svg
      className={`status-icon status-icon--${state}`}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      role="img"
      aria-label={RUN_STATE_LABELS[state]}
    >
      <title>{RUN_STATE_LABELS[state]}</title>
      <circle className="status-icon__ring" cx="8" cy="8" r="7" />
      <path className="status-icon__glyph" d={GLYPHS[state]} />
    </svg>
  );
}
