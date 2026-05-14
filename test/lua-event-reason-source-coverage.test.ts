import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  "test/lua-release-grouped-event.test.ts",
  "test/lua-remove-grouped-event.test.ts",
  "test/lua-return-to-grave-event.test.ts",
  "test/lua-send-to-grave-grouped-event.test.ts",
  "test/lua-special-summon-event-source.test.ts",
  "test/lua-summon-negated-source-only-event.test.ts",
  "test/lua-swap-control-grouped-event.test.ts",
  "test/lua-swap-deck-grave-grouped-event.test.ts",
] as const;

const eventReasonConditionFixtureFiles = [
  "test/lua-real-script-previous-controller-previous-location-event-reason-condition.test.ts",
  "test/lua-real-script-source-previous-location-event-reason-all-condition.test.ts",
  "test/lua-real-script-source-previous-location-event-reason-all-player-condition.test.ts",
  "test/lua-real-script-source-previous-location-event-reason-condition.test.ts",
] as const;

const sourceReasonConditionFixtureFiles = [
  "test/lua-real-script-local-double-reason-all-condition.test.ts",
  "test/lua-real-script-source-get-reason-all-condition.test.ts",
  "test/lua-real-script-source-get-reason-condition.test.ts",
  "test/lua-real-script-source-reason-condition.test.ts",
  "test/lua-real-script-source-reason-not-condition.test.ts",
  "test/lua-real-script-source-reason-player-condition.test.ts",
] as const;

const chainEventMetadataFixtureFiles = [
  "test/lua-chain-activation-event.test.ts",
  "test/lua-chain-disabled-event.test.ts",
  "test/lua-chain-negated-event.test.ts",
  "test/lua-chain-solved-event.test.ts",
  "test/lua-chain-solving-event.test.ts",
] as const;

describe("Lua event reason source coverage", () => {
  it("keeps active reason-source fixture inventory explicit", () => {
    expect(discoveredReasonSourceFixtureFiles()).toEqual([...reasonSourceFixtureFiles]);
  });

  it("requires reason-source fixtures to assert both card and effect reason metadata", () => {
    const missing = reasonSourceFixtureFiles.filter((file) => {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      return !text.includes("eventReasonCardUid") || !text.includes("eventReasonEffectId");
    });

    expect(missing).toEqual([]);
  });

  it("keeps restored event-reason condition fixture inventory explicit", () => {
    expect(discoveredEventReasonConditionFixtureFiles()).toEqual([...eventReasonConditionFixtureFiles]);
  });

  it("requires event-reason condition fixtures to prove restored predicates read event cause metadata", () => {
    const missing = eventReasonConditionFixtureFiles.filter((file) => {
      const text = fs.readFileSync(path.join(root, file), "utf8");
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

  it("requires source-reason condition fixtures to prove restored source cause metadata", () => {
    const missing = sourceReasonConditionFixtureFiles
      .filter((file) => !fs.readFileSync(path.join(root, file), "utf8").includes("source-reason-player"))
      .filter((file) => {
      const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
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

  it("requires chain-event metadata fixtures to prove restore-safe related-effect causality", () => {
    const missing = chainEventMetadataFixtureFiles.filter((file) => {
      const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return text.includes("EVENT_CHAINING") || text.includes("EVENT_CHAIN_SOLVING");
      })
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("eventChainDepth") || !text.includes("eventChainLinkId");
      });

    expect(missing).toEqual([]);
  });
});

function discoveredReasonSourceFixtureFiles(): string[] {
  return fs.readdirSync(path.join(root, "test"))
    .filter((file) => /^lua-.*(?:event|event-reason).*\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .filter((file) => file !== "test/lua-event-reason-source-coverage.test.ts")
    .filter((file) => {
      const text = fs.readFileSync(path.join(root, file), "utf8");
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
      const text = fs.readFileSync(path.join(root, file), "utf8");
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
