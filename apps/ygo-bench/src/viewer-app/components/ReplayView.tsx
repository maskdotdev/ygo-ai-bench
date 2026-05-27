import { useEffect, useMemo, useState } from "react";
import { firstDecisionIndex, replayFrames } from "../state/traceSelectors";
import type { RunDetails, TraceFrame } from "../types";
import { BoardView } from "./BoardView";
import { DecisionPanel } from "./DecisionPanel";
import { MetadataPanel } from "./MetadataPanel";
import { PromptPanel } from "./PromptPanel";
import { ScorePanel } from "./ScorePanel";
import { Timeline } from "./Timeline";
import { TranscriptDrawer } from "./TranscriptDrawer";

export function ReplayView({ details, trace, transcript }: { details: RunDetails; trace: TraceFrame[]; transcript: string }) {
  const frames = useMemo(() => replayFrames(trace, details.reducedState), [trace, details.reducedState]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(firstDecisionIndex(frames));
  }, [frames]);

  const current = frames[index] ?? null;
  const currentFrame = current?.frame ?? null;

  return (
    <section className="replay-layout">
      <div className="replay-main">
        <div className="replay-toolbar">
          <div>
            <h2>{details.score.scenarioId}</h2>
            <span>
              {details.score.agentId} | {details.score.family}
            </span>
          </div>
          <div className="stepper">
            <button onClick={() => setIndex(0)} disabled={index === 0}>
              First
            </button>
            <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
              Prev
            </button>
            <strong>
              {frames.length === 0 ? 0 : index + 1} / {frames.length}
            </strong>
            <button onClick={() => setIndex(Math.min(frames.length - 1, index + 1))} disabled={index >= frames.length - 1}>
              Next
            </button>
            <button onClick={() => setIndex(frames.length - 1)} disabled={index >= frames.length - 1}>
              Last
            </button>
          </div>
        </div>
        <BoardView state={current?.state ?? details.reducedState} player={currentFrame?.player} />
        <div className="lower-grid">
          <DecisionPanel frame={currentFrame} />
          <PromptPanel frame={currentFrame} />
        </div>
        <TranscriptDrawer transcript={transcript} />
      </div>
      <aside className="right-rail">
        <ScorePanel score={details.score} />
        <Timeline frames={frames} currentIndex={index} onSelect={setIndex} />
        <MetadataPanel details={details} />
      </aside>
    </section>
  );
}
