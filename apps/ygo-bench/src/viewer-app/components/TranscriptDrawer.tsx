export function TranscriptDrawer({ transcript }: { transcript: string }) {
  return (
    <section className="panel transcript-panel">
      <div className="section-head">
        <h2>Transcript</h2>
        <span>{transcript ? `${transcript.length.toLocaleString()} chars` : "missing"}</span>
      </div>
      <pre>{transcript || "No model transcript artifact was found for this run."}</pre>
    </section>
  );
}
