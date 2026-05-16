import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const responseFixtureCount = 17;
const chainedResponseFixtureCount = 16;
const responseOperationInfoFixtureCount = 16;

describe("Lua real response restore coverage", () => {
  it("requires representative non-negating response fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptResponseFixtureFiles();
    expect(files).toHaveLength(responseFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative response fixtures to prove restored response outcomes", () => {
    const files = realScriptResponseFixtureFiles();
    expect(files).toHaveLength(responseFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("host.messages).not.toContain")
          || !/location:\s*["'](graveyard|hand|banished|monsterZone)["']/.test(text)
          || !/eventName:\s*["'](chainDisabled|positionChanged|cardsDrawn|destroyed|sentToDeck|sentToHand|banished|specialSummoned|damageDealt|recoveredLifePoints|customEvent)["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires Called by the Grave to pin restored same-code lingering negation", () => {
    const text = coverageText(fs.readFileSync(path.join(root, "test", "lua-real-script-called-by-the-grave.test.ts"), "utf8"));

    expect(text).toContain("code: 2");
    expect(text).toContain("code: 1020");
    expect(text).toContain("sourceUid: \"p0-deck-24224830-0\"");
    expect(text).toContain('location: "banished"');
    expect(text).toContain('host.messages).not.toContain("same-code monster resolved")');
    expect(text).toContain("expect(restored.session.state.chain).toHaveLength(0)");
    expect(text).toContain("expect(session.state.chain).toHaveLength(0)");
    expect(text).toContain('eventName: "chainDisabled"');
  });

  it("requires chained response fixtures to prove restored chain shape and response suppression", () => {
    const files = realScriptChainedResponseFixtureFiles();
    expect(files).toHaveLength(chainedResponseFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/state\.chain\)\.toHaveLength\((1|2)\)/.test(text)
          || !text.includes("chainResponderScript")
          || !text.includes("host.messages).not.toContain");
      });

    expect(missing).toEqual([]);
  });

  it("requires operation-info assertions for chained response fixtures that announce categories", () => {
    const files = realScriptResponseOperationInfoFixtureFiles();
    expect(files).toHaveLength(responseOperationInfoFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !/category:\s*0x[0-9a-f]+/i.test(text)
          || !/count:\s*[0-9]/.test(text)
          || !/player:\s*[01]/.test(text)
          || !/parameter:\s*[0-9]/.test(text);
      });

    expect(missing).toEqual([]);
  });
});

function realScriptResponseFixtureFiles(): string[] {
  return [
    "lua-real-script-amaterasu-set-available-chain.test.ts",
    "lua-real-script-armor-blast-multi-target-free-chain.test.ts",
    "lua-real-script-book-of-moon-free-chain.test.ts",
    "lua-real-script-called-by-the-grave.test.ts",
    "lua-real-script-compulsory-evacuation-device-free-chain.test.ts",
    "lua-real-script-cosmic-cyclone-free-chain.test.ts",
    "lua-real-script-dimensional-prison-battle-window.test.ts",
    "lua-real-script-draining-shield-battle-window.test.ts",
    "lua-real-script-droll-lock-bird-draw-search-lock.test.ts",
    "lua-real-script-ghost-ogre-chain-destroy.test.ts",
    "lua-real-script-magic-cylinder-battle-window.test.ts",
    "lua-real-script-monster-reborn-free-chain.test.ts",
    "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
    "lua-real-script-phoenix-wing-wind-blast-discard-cost.test.ts",
    "lua-real-script-raigeki-break-discard-cost.test.ts",
    "lua-real-script-sakuretsu-armor-battle-window.test.ts",
    "lua-real-script-twin-twisters-discard-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptChainedResponseFixtureFiles(): string[] {
  return realScriptResponseFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-called-by-the-grave.test.ts"));
}

function realScriptResponseOperationInfoFixtureFiles(): string[] {
  return realScriptChainedResponseFixtureFiles();
}
