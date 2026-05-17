import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");
const groupedEventFixtureCount = 18;
const groupedEventKindCounts = {
  changePosition: 1,
  confirm: 1,
  control: 2,
  counterRemove: 1,
  destroy: 1,
  discard: 1,
  draw: 1,
  genericSend: 1,
  overlayDetach: 1,
  release: 1,
  remove: 1,
  returnToGrave: 1,
  sendToGrave: 1,
  sendToHandDeck: 1,
  sourceOnly: 2,
  swapDeckGrave: 1,
} satisfies Record<GroupedEventKind, number>;

describe("Lua grouped event restore coverage", () => {
  it("keeps every grouped event fixture covered by complete Lua-aware snapshot restore and legal actions", () => {
    const files = groupedEventFixtureFiles();
    expect(files).toHaveLength(groupedEventFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)");
      });

    expect(missing).toEqual([]);
  });

  it("keeps grouped event fixture kinds explicit", () => {
    expect(countGroupedEventKinds(groupedEventFixtureFiles())).toEqual(groupedEventKindCounts);
  });
});

type GroupedEventKind =
  | "changePosition"
  | "confirm"
  | "control"
  | "counterRemove"
  | "destroy"
  | "discard"
  | "draw"
  | "genericSend"
  | "overlayDetach"
  | "release"
  | "remove"
  | "returnToGrave"
  | "sendToGrave"
  | "sendToHandDeck"
  | "sourceOnly"
  | "swapDeckGrave";

function groupedEventFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-.*(?:source-only-)?grouped-event\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}

function countGroupedEventKinds(files: string[]): Record<GroupedEventKind, number> {
  return files.reduce<Record<GroupedEventKind, number>>(
    (counts, file) => {
      counts[classifyGroupedEventKind(file)] += 1;
      return counts;
    },
    {
      changePosition: 0,
      confirm: 0,
      control: 0,
      counterRemove: 0,
      destroy: 0,
      discard: 0,
      draw: 0,
      genericSend: 0,
      overlayDetach: 0,
      release: 0,
      remove: 0,
      returnToGrave: 0,
      sendToGrave: 0,
      sendToHandDeck: 0,
      sourceOnly: 0,
      swapDeckGrave: 0,
    },
  );
}

function classifyGroupedEventKind(file: string): GroupedEventKind {
  const basename = path.basename(file);
  if (basename === "lua-change-position-grouped-event.test.ts") return "changePosition";
  if (basename === "lua-confirm-grouped-event.test.ts") return "confirm";
  if (basename === "lua-counter-remove-grouped-event.test.ts") return "counterRemove";
  if (basename === "lua-destroy-grouped-event.test.ts") return "destroy";
  if (basename === "lua-discard-grouped-event.test.ts") return "discard";
  if (basename === "lua-draw-grouped-event.test.ts") return "draw";
  if (basename === "lua-generic-sendto-grouped-event.test.ts") return "genericSend";
  if (basename === "lua-overlay-detach-grouped-event.test.ts") return "overlayDetach";
  if (basename === "lua-release-grouped-event.test.ts") return "release";
  if (basename === "lua-remove-grouped-event.test.ts") return "remove";
  if (basename === "lua-return-to-grave-grouped-event.test.ts") return "returnToGrave";
  if (basename === "lua-send-to-grave-grouped-event.test.ts") return "sendToGrave";
  if (basename === "lua-send-to-hand-deck-grouped-event.test.ts") return "sendToHandDeck";
  if (basename === "lua-swap-deck-grave-grouped-event.test.ts") return "swapDeckGrave";
  if (
    basename === "lua-get-control-grouped-event.test.ts" ||
    basename === "lua-swap-control-grouped-event.test.ts"
  ) {
    return "control";
  }
  if (
    basename === "lua-leave-field-source-only-grouped-event.test.ts" ||
    basename === "lua-move-source-only-grouped-event.test.ts"
  ) {
    return "sourceOnly";
  }
  throw new Error(`Unclassified grouped event fixture: ${file}`);
}
