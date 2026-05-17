import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

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
const groupedEventSemanticVariantCounts = {
  changePositionReasonAndGroupedChangePos: 1,
  confirmDeckAndToHandRevealGroups: 1,
  controlTakeReasonAndGroupedChange: 1,
  counterRemoveFieldGroup: 1,
  destroyReasonPreAndSuccessGroups: 1,
  discardDeckHandAndReasonGroups: 1,
  drawMultiCardGroup: 1,
  genericSendToGraveRemoveDeckAndReasonGroups: 1,
  leaveFieldSourceOnlyGroups: 1,
  moveAndLeaveGraveSourceOnlyGroups: 1,
  overlayDetachCardAndDuelGroups: 1,
  releaseDirectAndReasonGroups: 1,
  removeDirectAndReasonGroups: 1,
  returnToGraveDirectGroup: 1,
  sendToGraveDirectCleanupAndReasonGroups: 1,
  sendToHandAndDeckDirectGroups: 1,
  swapControlReasonAndGroupedChange: 1,
  swapDeckGraveGroupedAndReasonEvents: 1,
} satisfies Record<GroupedEventSemanticVariant, number>;

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

  it("keeps named grouped event semantic variants explicit", () => {
    expect(countGroupedEventSemanticVariants(groupedEventSemanticVariants())).toEqual(groupedEventSemanticVariantCounts);

    const weak = groupedEventSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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
type GroupedEventSemanticVariant =
  | "changePositionReasonAndGroupedChangePos"
  | "confirmDeckAndToHandRevealGroups"
  | "controlTakeReasonAndGroupedChange"
  | "counterRemoveFieldGroup"
  | "destroyReasonPreAndSuccessGroups"
  | "discardDeckHandAndReasonGroups"
  | "drawMultiCardGroup"
  | "genericSendToGraveRemoveDeckAndReasonGroups"
  | "leaveFieldSourceOnlyGroups"
  | "moveAndLeaveGraveSourceOnlyGroups"
  | "overlayDetachCardAndDuelGroups"
  | "releaseDirectAndReasonGroups"
  | "removeDirectAndReasonGroups"
  | "returnToGraveDirectGroup"
  | "sendToGraveDirectCleanupAndReasonGroups"
  | "sendToHandAndDeckDirectGroups"
  | "swapControlReasonAndGroupedChange"
  | "swapDeckGraveGroupedAndReasonEvents";

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

function groupedEventSemanticVariants(): Array<{
  file: string;
  kind: GroupedEventSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-change-position-grouped-event.test.ts",
      kind: "changePositionReasonAndGroupedChangePos",
      required: [
        "preserves active Lua reason source metadata for position-change events",
        "collects one grouped EVENT_CHANGE_POS success event for direct group position changes",
        "eventName: \"positionChanged\"",
        "position reason source true/true",
        "position generic group 2",
      ],
    },
    {
      file: "test/lua-confirm-grouped-event.test.ts",
      kind: "confirmDeckAndToHandRevealGroups",
      required: [
        "collects one grouped EVENT_CONFIRM event for revealed deck groups",
        "collects one grouped EVENT_TOHAND_CONFIRM event for revealed hand groups",
        "confirm generic group 2/2",
        "tohand confirm generic group 2/2",
        "Duel.GetOperatedGroup():GetCount()",
      ],
    },
    {
      file: "test/lua-counter-remove-grouped-event.test.ts",
      kind: "counterRemoveFieldGroup",
      required: [
        "collects one grouped EVENT_REMOVE_COUNTER success event for field counter removal",
        "Duel.RemoveCounter(tp, LOCATION_MZONE, 0, 99, 2, REASON_EFFECT)",
        "counter removed 2",
        "counter generic group 2/2",
        "eventUids).toEqual(expectedUids)",
      ],
    },
    {
      file: "test/lua-destroy-grouped-event.test.ts",
      kind: "destroyReasonPreAndSuccessGroups",
      required: [
        "preserves active Lua reason source metadata for grouped destruction events",
        "collects one grouped EVENT_DESTROY pre-event for direct group destruction",
        "collects one grouped EVENT_DESTROYED success event for direct group destruction",
        "destroy reason source true/true",
        "destroy generic group 2",
      ],
    },
    {
      file: "test/lua-discard-grouped-event.test.ts",
      kind: "discardDeckHandAndReasonGroups",
      required: [
        "collects one grouped EVENT_DISCARD success event for deck discards",
        "collects one grouped EVENT_TO_GRAVE success event for hand discards",
        "preserves active Lua reason source metadata for deck discard triggers",
        "eventName: \"discarded\"",
        "discard reason source true/true",
      ],
    },
    {
      file: "test/lua-draw-grouped-event.test.ts",
      kind: "drawMultiCardGroup",
      required: [
        "collects one grouped EVENT_DRAW success event for multi-card draws",
        "Duel.Draw(tp, 2, REASON_EFFECT)",
        "draw grouped 2",
        "draw generic group 2/2",
        "eventUids).toEqual(expectedDrawnUids)",
      ],
    },
    {
      file: "test/lua-generic-sendto-grouped-event.test.ts",
      kind: "genericSendToGraveRemoveDeckAndReasonGroups",
      required: [
        "collects one grouped EVENT_TO_GRAVE success event for generic grave sends",
        "collects one grouped EVENT_REMOVE success event for generic banish sends",
        "collects one grouped EVENT_TO_DECK success event for MoveToDeckTop sends",
        "preserves active Lua reason source metadata for generic $label sends",
        "extra ${label} single reason source true/true",
      ],
    },
    {
      file: "test/lua-get-control-grouped-event.test.ts",
      kind: "controlTakeReasonAndGroupedChange",
      required: [
        "preserves active Lua reason source metadata for controlled cards and grouped control events",
        "collects one grouped EVENT_CONTROL_CHANGED event for direct group control changes",
        "eventName: \"controlChanged\"",
        "control reason source true/true",
        "control generic group 2",
      ],
    },
    {
      file: "test/lua-leave-field-source-only-grouped-event.test.ts",
      kind: "leaveFieldSourceOnlyGroups",
      required: [
        "groups EVENT_LEAVE_FIELD and binds single triggers only to their leaving source cards",
        "eventName === \"leftField\"",
        "first leave field 2/2",
        "generic leave field 2/2",
        "wrong leave field 2",
      ],
    },
    {
      file: "test/lua-move-source-only-grouped-event.test.ts",
      kind: "moveAndLeaveGraveSourceOnlyGroups",
      required: [
        "binds EVENT_MOVE single triggers only to their moved source cards",
        "binds EVENT_LEAVE_GRAVE single triggers only to their source card",
        "groups EVENT_LEAVE_GRAVE for multi-card moves out of the graveyard",
        "generic move 2/2",
        "generic leave group 2/2",
      ],
    },
    {
      file: "test/lua-overlay-detach-grouped-event.test.ts",
      kind: "overlayDetachCardAndDuelGroups",
      required: [
        "binds grouped EVENT_DETACH_MATERIAL single triggers only to detached materials",
        "collects one grouped detach and grave event for Card.RemoveOverlayCard",
        "collects one grouped detach and grave event for Duel.RemoveOverlayCard",
        "eventName: \"detachedMaterial\"",
        "eventName: \"sentToGraveyard\"",
      ],
    },
    {
      file: "test/lua-release-grouped-event.test.ts",
      kind: "releaseDirectAndReasonGroups",
      required: [
        "collects one grouped EVENT_RELEASE success event for direct group releases",
        "preserves active Lua reason source metadata for release triggers",
        "eventName: \"released\"",
        "release generic group 2",
        "release reason source true/true",
      ],
    },
    {
      file: "test/lua-remove-grouped-event.test.ts",
      kind: "removeDirectAndReasonGroups",
      required: [
        "collects one grouped EVENT_REMOVE success event for direct group banishes",
        "preserves active Lua reason source metadata for banish triggers",
        "eventName: \"banished\"",
        "remove generic group 2",
        "remove reason source true/true",
      ],
    },
    {
      file: "test/lua-return-to-grave-grouped-event.test.ts",
      kind: "returnToGraveDirectGroup",
      required: [
        "collects one grouped EVENT_RETURN_TO_GRAVE success event for direct group returns",
        "Duel.ReturnToGrave(Group.FromCards(first, second))",
        "return grouped 2",
        "return generic group 2",
        "eventUids).toEqual([first!.uid, second!.uid])",
      ],
    },
    {
      file: "test/lua-send-to-grave-grouped-event.test.ts",
      kind: "sendToGraveDirectCleanupAndReasonGroups",
      required: [
        "collects one grouped EVENT_TO_GRAVE success event for direct group sends",
        "regroups after earlier Lua move-step timing cleanup in the same operation",
        "preserves active Lua reason source metadata for send-to-grave triggers",
        "eventName: \"sentToGraveyard\"",
        "grave event reason source true/true",
      ],
    },
    {
      file: "test/lua-send-to-hand-deck-grouped-event.test.ts",
      kind: "sendToHandAndDeckDirectGroups",
      required: [
        "collects one grouped $eventCode success event for direct group sends",
        "EVENT_TO_HAND",
        "EVENT_TO_DECK",
        "`${label} grouped 2`",
        "`${label} generic group 2`",
      ],
    },
    {
      file: "test/lua-swap-control-grouped-event.test.ts",
      kind: "swapControlReasonAndGroupedChange",
      required: [
        "preserves active Lua reason source metadata for swapped cards and grouped control events",
        "collects one grouped EVENT_CONTROL_CHANGED event for paired swaps",
        "eventName: \"controlChanged\"",
        "swap reason self true/true",
        "swap generic group 2",
      ],
    },
    {
      file: "test/lua-swap-deck-grave-grouped-event.test.ts",
      kind: "swapDeckGraveGroupedAndReasonEvents",
      required: [
        "collects grouped success events for deck cards sent to grave and grave cards sent to deck",
        "preserves active Lua reason source metadata for swapped deck-to-grave triggers",
        "eventName === \"sentToGraveyard\"",
        "eventName === \"sentToDeck\"",
        "swap deck reason source true/true",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: GroupedEventSemanticVariant;
    required: string[];
  }>);
}

function countGroupedEventSemanticVariants(
  variants: Array<{ kind: GroupedEventSemanticVariant }>,
): Record<GroupedEventSemanticVariant, number> {
  return variants.reduce<Record<GroupedEventSemanticVariant, number>>(
    (counts, variant) => {
      counts[variant.kind] += 1;
      return counts;
    },
    {
      changePositionReasonAndGroupedChangePos: 0,
      confirmDeckAndToHandRevealGroups: 0,
      controlTakeReasonAndGroupedChange: 0,
      counterRemoveFieldGroup: 0,
      destroyReasonPreAndSuccessGroups: 0,
      discardDeckHandAndReasonGroups: 0,
      drawMultiCardGroup: 0,
      genericSendToGraveRemoveDeckAndReasonGroups: 0,
      leaveFieldSourceOnlyGroups: 0,
      moveAndLeaveGraveSourceOnlyGroups: 0,
      overlayDetachCardAndDuelGroups: 0,
      releaseDirectAndReasonGroups: 0,
      removeDirectAndReasonGroups: 0,
      returnToGraveDirectGroup: 0,
      sendToGraveDirectCleanupAndReasonGroups: 0,
      sendToHandAndDeckDirectGroups: 0,
      swapControlReasonAndGroupedChange: 0,
      swapDeckGraveGroupedAndReasonEvents: 0,
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
