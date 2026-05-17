import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

const reasonSourceFixtureFiles = [
  "test/lua-attack-negation-event-source.test.ts",
  "test/lua-become-target-event.test.ts",
  "test/lua-break-effect-event.test.ts",
  "test/lua-chain-event-helpers.test.ts",
  "test/lua-change-position-grouped-event.test.ts",
  "test/lua-counter-event.test.ts",
  "test/lua-destroy-grouped-event.test.ts",
  "test/lua-discard-grouped-event.test.ts",
  "test/lua-generic-sendto-grouped-event.test.ts",
  "test/lua-get-control-grouped-event.test.ts",
  "test/lua-level-up-event.test.ts",
  "test/lua-move-event.test.ts",
  "test/lua-raise-event-payload.test.ts",
  "test/lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
  "test/lua-release-grouped-event.test.ts",
  "test/lua-remove-grouped-event.test.ts",
  "test/lua-return-to-grave-event.test.ts",
  "test/lua-send-to-grave-grouped-event.test.ts",
  "test/lua-special-summon-event-source.test.ts",
  "test/lua-summon-negated-source-only-event.test.ts",
  "test/lua-swap-control-grouped-event.test.ts",
  "test/lua-swap-deck-grave-grouped-event.test.ts",
] as const;
const reasonSourceKindCounts = {
  battleAndTarget: 2,
  chainCustom: 3,
  groupedMovement: 12,
  stateChange: 3,
  summon: 2,
} satisfies Record<ReasonSourceKind, number>;

const eventReasonConditionFixtureFiles = [
  "test/lua-real-script-previous-controller-previous-location-event-reason-condition.test.ts",
  "test/lua-real-script-source-previous-location-event-reason-all-condition.test.ts",
  "test/lua-real-script-source-previous-location-event-reason-all-player-condition.test.ts",
  "test/lua-real-script-source-previous-location-event-reason-condition.test.ts",
] as const;
const eventReasonConditionKindCounts = {
  previousState: 1,
  sourceAllReason: 1,
  sourceAllReasonPlayer: 1,
  sourceReason: 1,
} satisfies Record<EventReasonConditionKind, number>;

const sourceReasonConditionFixtureFiles = [
  "test/lua-real-script-local-double-reason-all-condition.test.ts",
  "test/lua-real-script-source-get-reason-all-condition.test.ts",
  "test/lua-real-script-source-get-reason-condition.test.ts",
  "test/lua-real-script-source-reason-condition.test.ts",
  "test/lua-real-script-source-reason-not-condition.test.ts",
  "test/lua-real-script-source-reason-player-condition.test.ts",
] as const;
const sourceReasonConditionKindCounts = {
  allReason: 2,
  directReason: 3,
  playerReason: 1,
} satisfies Record<SourceReasonConditionKind, number>;

const chainEventMetadataFixtureFiles = [
  "test/lua-chain-activation-event.test.ts",
  "test/lua-chain-disabled-event.test.ts",
  "test/lua-chain-negated-event.test.ts",
  "test/lua-chain-solved-event.test.ts",
  "test/lua-chain-solving-event.test.ts",
] as const;
const chainEventMetadataKindCounts = {
  activation: 1,
  negation: 2,
  resolution: 2,
} satisfies Record<ChainEventMetadataKind, number>;

describe("Lua event reason source coverage", () => {
  it("keeps active reason-source fixture inventory explicit", () => {
    expect(discoveredReasonSourceFixtureFiles()).toEqual([...reasonSourceFixtureFiles]);
  });

  it("keeps reason-source fixture kinds explicit", () => {
    expect(countReasonSourceKinds(reasonSourceFixtureFiles)).toEqual(reasonSourceKindCounts);
  });

  it("requires reason-source fixtures to assert both card and effect reason metadata", () => {
    const missing = reasonSourceFixtureFiles.filter((file) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return !text.includes("eventReasonCardUid") || !text.includes("eventReasonEffectId");
    });

    expect(missing).toEqual([]);
  });

  it("keeps restored event-reason condition fixture inventory explicit", () => {
    expect(discoveredEventReasonConditionFixtureFiles()).toEqual([...eventReasonConditionFixtureFiles]);
  });

  it("keeps event-reason condition fixture kinds explicit", () => {
    expect(countEventReasonConditionKinds(eventReasonConditionFixtureFiles)).toEqual(eventReasonConditionKindCounts);
  });

  it("requires event-reason condition fixtures to prove restored predicates read event cause metadata", () => {
    const missing = eventReasonConditionFixtureFiles.filter((file) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return !text.includes("restoreDuelWithLuaScripts")
        || !text.includes("restoreComplete")
        || !text.includes('incompleteReasons.join("; ")')
        || !text.includes("missingRegistryKeys).toEqual([])")
        || !text.includes("luaConditionDescriptor")
        || !text.includes("eventReason:");
    });

    expect(missing).toEqual([]);
  });

  it("requires player-sensitive event-reason condition fixtures to prove restored predicates read reason player metadata", () => {
    const missing = eventReasonConditionFixtureFiles
      .filter((file) => fs.readFileSync(path.join(root, file), "utf8").includes("-player:"))
      .filter((file) => !fs.readFileSync(path.join(root, file), "utf8").includes("eventReasonPlayer:"));

    expect(missing).toEqual([]);
  });

  it("keeps source-reason condition fixture inventory explicit", () => {
    expect(discoveredSourceReasonConditionFixtureFiles()).toEqual([...sourceReasonConditionFixtureFiles]);
  });

  it("keeps source-reason condition fixture kinds explicit", () => {
    expect(countSourceReasonConditionKinds(sourceReasonConditionFixtureFiles)).toEqual(sourceReasonConditionKindCounts);
  });

  it("requires source-reason condition fixtures to prove restored source cause metadata", () => {
    const missing = sourceReasonConditionFixtureFiles
      .filter((file) => !fs.readFileSync(path.join(root, file), "utf8").includes("source-reason-player"))
      .filter((file) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return !text.includes("restoreDuelWithLuaScripts")
        || !text.includes("restoreComplete")
        || !text.includes('incompleteReasons.join("; ")')
        || !text.includes("missingRegistryKeys).toEqual([])")
        || !text.includes("luaConditionDescriptor")
        || !text.includes("canActivate")
        || !text.includes(".reason =")
        || !text.includes("toBe(true)")
        || !text.includes("toBe(false)");
    });

    expect(missing).toEqual([]);
  });

  it("requires representative source-reason fixtures to prove event-reason fallback metadata", () => {
    const fallbackFiles = [
      "test/lua-real-script-source-get-reason-all-condition.test.ts",
      "test/lua-real-script-source-reason-condition.test.ts",
      "test/lua-real-script-source-reason-not-condition.test.ts",
    ];
    const missing = fallbackFiles.filter((file) => !fs.readFileSync(path.join(root, file), "utf8").includes("eventReason:"));

    expect(missing).toEqual([]);
  });

  it("requires source reason-player fixtures to prove restored player-sensitive cause metadata", () => {
    const missing = sourceReasonConditionFixtureFiles
      .filter((file) => fs.readFileSync(path.join(root, file), "utf8").includes("source-reason-player"))
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes(".reasonPlayer =")
          || !text.includes("condition:source-reason-player:opponent")
          || !text.includes("condition:source-reason-player:self")
          || !text.includes("eventReasonPlayer:");
      });

    expect(missing).toEqual([]);
  });

  it("keeps chain-event metadata fixture inventory explicit", () => {
    expect(discoveredChainEventMetadataFixtureFiles()).toEqual([...chainEventMetadataFixtureFiles]);
  });

  it("keeps chain-event metadata fixture kinds explicit", () => {
    expect(countChainEventMetadataKinds(chainEventMetadataFixtureFiles)).toEqual(chainEventMetadataKindCounts);
  });

  it("requires chain-event metadata fixtures to prove restore-safe related-effect causality", () => {
    const missing = chainEventMetadataFixtureFiles.filter((file) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return !text.includes("restoreDuelWithLuaScripts")
        || !text.includes("restoreComplete")
        || !text.includes('incompleteReasons.join("; ")')
        || !text.includes("missingRegistryKeys).toEqual([])")
        || !text.includes("pendingTriggers")
        || !text.includes("eventHistory")
        || !text.includes("eventReasonPlayer")
        || !text.includes("relatedEffectId")
        || !text.includes("related effect true");
    });

    expect(missing).toEqual([]);
  });

  it("requires chain-window event fixtures to assert chain depth and chain link identity", () => {
    const missing = chainEventMetadataFixtureFiles
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("EVENT_CHAINING") || text.includes("EVENT_CHAIN_SOLVING");
      })
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("eventChainDepth") || !text.includes("eventChainLinkId");
      });

    expect(missing).toEqual([]);
  });
});

type ReasonSourceKind = "battleAndTarget" | "chainCustom" | "groupedMovement" | "stateChange" | "summon";
type EventReasonConditionKind = "previousState" | "sourceAllReason" | "sourceAllReasonPlayer" | "sourceReason";
type SourceReasonConditionKind = "allReason" | "directReason" | "playerReason";
type ChainEventMetadataKind = "activation" | "negation" | "resolution";

function discoveredReasonSourceFixtureFiles(): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => /^lua-.*(?:event|event-reason).*\.test\.ts$/.test(file))
    .filter((file) => !file.endsWith("-coverage.test.ts"))
    .map((file) => path.join("test", file))
    .filter((file) => file !== "test/lua-event-reason-source-coverage.test.ts")
    .filter((file) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return text.includes("eventReasonCardUid") || text.includes("eventReasonEffectId") || text.includes("reason source");
    })
    .sort();
}

function discoveredEventReasonConditionFixtureFiles(): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => /^lua-real-script-.*event-reason.*condition\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}

function discoveredSourceReasonConditionFixtureFiles(): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => /^lua-real-script-.*reason.*condition\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .filter((file) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return text.includes("condition:source-reason");
    })
    .sort();
}

function discoveredChainEventMetadataFixtureFiles(): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => /^lua-chain-(?:activation|disabled|negated|solved|solving)-event\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}

function countReasonSourceKinds(files: readonly string[]): Record<ReasonSourceKind, number> {
  return files.reduce<Record<ReasonSourceKind, number>>(
    (counts, file) => {
      counts[classifyReasonSourceKind(file)] += 1;
      return counts;
    },
    { battleAndTarget: 0, chainCustom: 0, groupedMovement: 0, stateChange: 0, summon: 0 },
  );
}

function classifyReasonSourceKind(file: string): ReasonSourceKind {
  const basename = path.basename(file);
  if (basename === "lua-attack-negation-event-source.test.ts" || basename === "lua-become-target-event.test.ts") return "battleAndTarget";
  if (basename === "lua-break-effect-event.test.ts" || basename === "lua-chain-event-helpers.test.ts" || basename === "lua-raise-event-payload.test.ts") return "chainCustom";
  if (
    basename === "lua-change-position-grouped-event.test.ts" ||
    basename === "lua-destroy-grouped-event.test.ts" ||
    basename === "lua-discard-grouped-event.test.ts" ||
    basename === "lua-generic-sendto-grouped-event.test.ts" ||
    basename === "lua-get-control-grouped-event.test.ts" ||
    basename === "lua-move-event.test.ts" ||
    basename === "lua-release-grouped-event.test.ts" ||
    basename === "lua-remove-grouped-event.test.ts" ||
    basename === "lua-return-to-grave-event.test.ts" ||
    basename === "lua-send-to-grave-grouped-event.test.ts" ||
    basename === "lua-swap-control-grouped-event.test.ts" ||
    basename === "lua-swap-deck-grave-grouped-event.test.ts"
  ) {
    return "groupedMovement";
  }
  if (
    basename === "lua-counter-event.test.ts" ||
    basename === "lua-level-up-event.test.ts" ||
    basename === "lua-real-script-naturia-ragweed-event-draw-trigger.test.ts"
  ) {
    return "stateChange";
  }
  if (basename === "lua-special-summon-event-source.test.ts" || basename === "lua-summon-negated-source-only-event.test.ts") return "summon";
  throw new Error(`Unclassified reason-source fixture: ${file}`);
}

function countEventReasonConditionKinds(files: readonly string[]): Record<EventReasonConditionKind, number> {
  return files.reduce<Record<EventReasonConditionKind, number>>(
    (counts, file) => {
      counts[classifyEventReasonConditionKind(file)] += 1;
      return counts;
    },
    { previousState: 0, sourceAllReason: 0, sourceAllReasonPlayer: 0, sourceReason: 0 },
  );
}

function classifyEventReasonConditionKind(file: string): EventReasonConditionKind {
  const basename = path.basename(file);
  if (basename === "lua-real-script-previous-controller-previous-location-event-reason-condition.test.ts") return "previousState";
  if (basename === "lua-real-script-source-previous-location-event-reason-all-condition.test.ts") return "sourceAllReason";
  if (basename === "lua-real-script-source-previous-location-event-reason-all-player-condition.test.ts") return "sourceAllReasonPlayer";
  if (basename === "lua-real-script-source-previous-location-event-reason-condition.test.ts") return "sourceReason";
  throw new Error(`Unclassified event-reason condition fixture: ${file}`);
}

function countSourceReasonConditionKinds(files: readonly string[]): Record<SourceReasonConditionKind, number> {
  return files.reduce<Record<SourceReasonConditionKind, number>>(
    (counts, file) => {
      counts[classifySourceReasonConditionKind(file)] += 1;
      return counts;
    },
    { allReason: 0, directReason: 0, playerReason: 0 },
  );
}

function classifySourceReasonConditionKind(file: string): SourceReasonConditionKind {
  const basename = path.basename(file);
  if (basename === "lua-real-script-local-double-reason-all-condition.test.ts" || basename === "lua-real-script-source-get-reason-all-condition.test.ts") return "allReason";
  if (
    basename === "lua-real-script-source-get-reason-condition.test.ts" ||
    basename === "lua-real-script-source-reason-condition.test.ts" ||
    basename === "lua-real-script-source-reason-not-condition.test.ts"
  ) {
    return "directReason";
  }
  if (basename === "lua-real-script-source-reason-player-condition.test.ts") return "playerReason";
  throw new Error(`Unclassified source-reason condition fixture: ${file}`);
}

function countChainEventMetadataKinds(files: readonly string[]): Record<ChainEventMetadataKind, number> {
  return files.reduce<Record<ChainEventMetadataKind, number>>(
    (counts, file) => {
      counts[classifyChainEventMetadataKind(file)] += 1;
      return counts;
    },
    { activation: 0, negation: 0, resolution: 0 },
  );
}

function classifyChainEventMetadataKind(file: string): ChainEventMetadataKind {
  const basename = path.basename(file);
  if (basename === "lua-chain-activation-event.test.ts") return "activation";
  if (basename === "lua-chain-disabled-event.test.ts" || basename === "lua-chain-negated-event.test.ts") return "negation";
  if (basename === "lua-chain-solved-event.test.ts" || basename === "lua-chain-solving-event.test.ts") return "resolution";
  throw new Error(`Unclassified chain-event metadata fixture: ${file}`);
}
