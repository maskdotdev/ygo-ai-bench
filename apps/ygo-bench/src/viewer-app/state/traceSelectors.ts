import type { RealReducedState, ReplayFrame, TraceFrame } from "../types";

export function replayFrames(trace: TraceFrame[], finalState: RealReducedState | null): ReplayFrame[] {
  let lastState: RealReducedState | null = null;
  return trace
    .filter((frame) => frame.type === "event" || frame.type === "decision" || frame.type === "error")
    .map((frame, index) => {
      if (frame.reducedState) lastState = frame.reducedState;
      return {
        index,
        frame,
        state: lastState ?? finalState,
      };
    });
}

export function firstDecisionIndex(frames: ReplayFrame[]): number {
  const index = frames.findIndex((frame) => frame.frame.type === "decision");
  return index === -1 ? 0 : index;
}
