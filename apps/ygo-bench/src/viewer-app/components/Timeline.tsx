import type { ReplayFrame } from "../types";

export function Timeline({ frames, currentIndex, onSelect }: { frames: ReplayFrame[]; currentIndex: number; onSelect: (index: number) => void }) {
  return (
    <section className="panel timeline-panel">
      <div className="section-head">
        <h2>Timeline</h2>
        <span>{frames.length}</span>
      </div>
      <div className="timeline-list">
        {frames.map((entry, index) => (
          <button key={`${entry.index}-${index}`} className={`timeline-row ${index === currentIndex ? "active" : ""}`} onClick={() => onSelect(index)}>
            <span>{entry.frame.type === "decision" ? "Decision" : entry.frame.type === "error" ? "Error" : entry.frame.event ?? entry.frame.typeName ?? "Event"}</span>
            <small>{entry.frame.text ?? entry.frame.chosen?.reason ?? entry.frame.error ?? ""}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
