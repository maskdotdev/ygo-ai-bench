import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const negationFixtureCount = 9;
const chainResponseNegationFixtureCount = 8;
const destroyOnlyResponseFixtureCount = 4;

describe("Lua real negation restore coverage", () => {
  it("requires representative real-script negation fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptNegationFixtureFiles();
    expect(files).toHaveLength(negationFixtureCount);

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
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative real-script negation fixtures to prove restored chain suppression outcomes", () => {
    const files = realScriptNegationFixtureFiles();
    expect(files).toHaveLength(negationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/state\.chain\)\.toHaveLength\(0\)/.test(text)
          || !/eventName:\s*["']chainDisabled["']/.test(text)
          || !/location:\s*["']graveyard["']/.test(text)
          || !text.includes("operationInfos");
      });

    expect(missing).toEqual([]);
  });

  it("requires chain-response negation fixtures to pin negated-link events and suppressed follow-up operations", () => {
    const files = realScriptChainResponseNegationFixtureFiles();
    expect(files).toHaveLength(chainResponseNegationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/state\.chain\)\.toHaveLength\(2\)/.test(text)
          || (!/eventName:\s*["']chainNegated["']/.test(text) && !text.includes('"chainNegated"'))
          || (!/eventName:\s*["']chainDisabled["']/.test(text) && !text.includes('"chainDisabled"'))
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires destroy-only chain-response fixtures to prove restored destruction does not imply negation", () => {
    const files = realScriptDestroyOnlyResponseFixtureFiles();
    expect(files).toHaveLength(destroyOnlyResponseFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/state\.chain\)\.toHaveLength\(2\)/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/eventName:\s*["']destroyed["']/.test(text)
          || !/eventName:\s*["']cardsDrawn["']/.test(text)
          || (!/eventName:\s*["']chainNegated["']/.test(text) && !text.includes('"chainNegated"'))
          || (!/eventName:\s*["']chainDisabled["']/.test(text) && !text.includes('"chainDisabled"'))
          || (!/eventHistory\)\.not\.toEqual/.test(text) && !text.includes('["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])'))
          || !/host\.messages\)\.toContain/.test(text)
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });
});

function realScriptNegationFixtureFiles(): string[] {
  return [
    "lua-real-script-ash-blossom-chain-negate.test.ts",
    "lua-real-script-dark-bribe-negate-draw.test.ts",
    "lua-real-script-divine-wrath-monster-negate.test.ts",
    "lua-real-script-effect-veiler-chain-disable.test.ts",
    "lua-real-script-magic-jammer-chain-negate.test.ts",
    "lua-real-script-seven-tools-trap-negate.test.ts",
    "lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
    "lua-real-script-solemn-strike-special-summon-negate.test.ts",
    "lua-real-script-wiretap-trap-negate-to-deck.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptChainResponseNegationFixtureFiles(): string[] {
  return realScriptNegationFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-ash-blossom-chain-negate.test.ts"));
}

function realScriptDestroyOnlyResponseFixtureFiles(): string[] {
  return [
    "lua-real-script-ghost-ogre-chain-destroy.test.ts",
    "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
    "lua-real-script-raigeki-break-discard-cost.test.ts",
    "lua-real-script-twin-twisters-discard-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}
