import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const responseFixtureCount = 41;
const chainedResponseFixtureCount = 40;
const responseOperationInfoFixtureCount = 36;

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
          || !/location:\s*["'](graveyard|hand|banished|monsterZone|spellTrapZone)["']/.test(text)
          || !/eventName:\s*["'](chainDisabled|positionChanged|cardsDrawn|destroyed|sentToGraveyard|sentToDeck|sentToHand|banished|specialSummoned|damageDealt|recoveredLifePoints|attackDisabled|battleDamageDealt|customEvent)["']/.test(text);
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
    "lua-real-script-bad-reaction-reverse-recover.test.ts",
    "lua-real-script-black-horn-special-summon-negate.test.ts",
    "lua-real-script-book-of-moon-free-chain.test.ts",
    "lua-real-script-called-by-the-grave.test.ts",
    "lua-real-script-compulsory-evacuation-device-free-chain.test.ts",
    "lua-real-script-cosmic-cyclone-free-chain.test.ts",
    "lua-real-script-dark-bribe-negate-draw.test.ts",
    "lua-real-script-dimensional-prison-battle-window.test.ts",
    "lua-real-script-divine-wrath-monster-negate.test.ts",
    "lua-real-script-draining-shield-battle-window.test.ts",
    "lua-real-script-droll-lock-bird-draw-search-lock.test.ts",
    "lua-real-script-foolish-burial-deck-to-grave.test.ts",
    "lua-real-script-ghost-ogre-chain-destroy.test.ts",
    "lua-real-script-harpies-feather-duster-group-destroy.test.ts",
    "lua-real-script-grand-horn-special-summon-negate.test.ts",
    "lua-real-script-horn-of-heaven-release-cost-negate.test.ts",
    "lua-real-script-magic-jammer-chain-negate.test.ts",
    "lua-real-script-magic-cylinder-battle-window.test.ts",
    "lua-real-script-mirror-force-battle-window.test.ts",
    "lua-real-script-monster-reborn-free-chain.test.ts",
    "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
    "lua-real-script-negate-attack-battle-window.test.ts",
    "lua-real-script-phoenix-wing-wind-blast-discard-cost.test.ts",
    "lua-real-script-raigeki-group-destroy.test.ts",
    "lua-real-script-raigeki-break-discard-cost.test.ts",
    "lua-real-script-reinforcement-of-the-army-search.test.ts",
    "lua-real-script-sakuretsu-armor-battle-window.test.ts",
    "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
    "lua-real-script-seven-tools-trap-negate.test.ts",
    "lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
    "lua-real-script-solemn-judgment-summon-negate.test.ts",
    "lua-real-script-solemn-strike-special-summon-negate.test.ts",
    "lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
    "lua-real-script-solemn-warning-special-summon-effect-negate.test.ts",
    "lua-real-script-threatening-roar-temporary-attack-lock.test.ts",
    "lua-real-script-twin-twisters-discard-cost.test.ts",
    "lua-real-script-upstart-goblin-draw-recover.test.ts",
    "lua-real-script-waboku-temporary-battle-protection.test.ts",
    "lua-real-script-wiretap-trap-negate-to-deck.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptChainedResponseFixtureFiles(): string[] {
  return realScriptResponseFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-called-by-the-grave.test.ts"));
}

function realScriptResponseOperationInfoFixtureFiles(): string[] {
  return realScriptChainedResponseFixtureFiles()
    .filter((file) =>
      !file.endsWith("lua-real-script-negate-attack-battle-window.test.ts")
      && !file.endsWith("lua-real-script-scrap-iron-scarecrow-battle-window.test.ts")
      && !file.endsWith("lua-real-script-threatening-roar-temporary-attack-lock.test.ts")
      && !file.endsWith("lua-real-script-waboku-temporary-battle-protection.test.ts")
    );
}
