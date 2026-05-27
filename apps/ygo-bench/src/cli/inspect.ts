import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function inspectTrace(tracePath: string): Promise<string[]> {
  const raw = await readFile(resolve(tracePath), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => renderTraceLine(JSON.parse(line) as TraceLine))
    .filter((line) => line.length > 0);
}

export function renderTraceLine(frame: TraceLine): string {
  if (frame.type === "event") {
    const prefix = [frame.turn ? `Turn ${frame.turn}` : null, frame.phase].filter(Boolean).join(" / ");
    return prefix ? `[${prefix}] ${frame.text ?? frame.event ?? ""}` : String(frame.text ?? frame.event ?? "");
  }
  if (frame.type === "engine") {
    return String(frame.text ?? frame.typeName ?? frame.message?.type ?? "");
  }
  if (frame.type === "decision") {
    return `Decision: ${frame.chosen?.actionId ?? "unknown"} - ${frame.chosen?.reason ?? ""}`;
  }
  if (frame.type === "error") {
    return `Error: ${frame.message ?? "unknown"}`;
  }
  return "";
}

interface TraceLine {
  type: string;
  text?: string;
  event?: string;
  turn?: number;
  phase?: string;
  typeName?: string;
  message?: { type?: string | number };
  chosen?: { actionId?: string; reason?: string };
}
