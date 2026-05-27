import type { TraceFrame } from "../types";

export function PromptPanel({ frame }: { frame: TraceFrame | null }) {
  if (!frame || frame.type !== "decision") return <section className="panel prompt-panel empty-block">No prompt selected.</section>;
  return (
    <section className="panel prompt-panel">
      <div className="section-head">
        <h2>Prompt</h2>
        <span>{String(frame.observation?.prompt ? (frame.observation.prompt as { type?: string }).type ?? "decision" : "decision")}</span>
      </div>
      <pre>{JSON.stringify(frame.observation ?? {}, null, 2)}</pre>
    </section>
  );
}
