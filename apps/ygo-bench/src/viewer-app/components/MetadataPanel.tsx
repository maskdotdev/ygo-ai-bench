import type { RunDetails } from "../types";

export function MetadataPanel({ details }: { details: RunDetails }) {
  return (
    <section className="panel metadata-panel">
      <div className="section-head">
        <h2>Metadata</h2>
        <span>{details.run.id}</span>
      </div>
      <div className="artifact-links">
        <a href={details.artifacts.trace} target="_blank" rel="noreferrer">
          trace.jsonl
        </a>
        <a href={details.artifacts.score} target="_blank" rel="noreferrer">
          final-score.json
        </a>
        {details.artifacts.metadata ? (
          <a href={details.artifacts.metadata} target="_blank" rel="noreferrer">
            metadata.json
          </a>
        ) : null}
      </div>
      <pre>{JSON.stringify(details.metadata ?? {}, null, 2)}</pre>
    </section>
  );
}
