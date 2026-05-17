import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const responseFixtureCount = 121;
const chainedResponseFixtureCount = 120;
const responseOperationInfoFixtureCount = 112;
const responseWithoutOperationInfoFixtureFiles = [
  "test/lua-real-script-angineer-overlay-position.test.ts",
  "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
  "test/lua-real-script-hebo-spirit-grant-return.test.ts",
  "test/lua-real-script-negate-attack-battle-window.test.ts",
  "test/lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
  "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
  "test/lua-real-script-threatening-roar-temporary-attack-lock.test.ts",
  "test/lua-real-script-waboku-temporary-battle-protection.test.ts",
];
const responseFixtureKindCounts = {
  chainedResponseWithOperationInfo: 112,
  chainedResponseWithoutOperationInfo: 8,
  lingeringSameCodeNegation: 1,
} satisfies Record<ResponseFixtureKind, number>;

describe("Lua real response restore coverage", () => {
  it("keeps response fixture kinds explicit", () => {
    expect(countResponseFixtureKinds(realScriptResponseFixtureFiles())).toEqual(responseFixtureKindCounts);
  });

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

  it("keeps chained response fixtures without operation-info assertions explicit", () => {
    const operationInfoFiles = new Set(realScriptResponseOperationInfoFixtureFiles());
    const files = realScriptChainedResponseFixtureFiles()
      .filter((file) => !operationInfoFiles.has(file));

    expect(files).toEqual(responseWithoutOperationInfoFixtureFiles);
  });

  it("requires chained response fixtures without operation-info assertions to prove empty operation info", () => {
    const operationInfoFiles = new Set(realScriptResponseOperationInfoFixtureFiles());
    const files = realScriptChainedResponseFixtureFiles()
      .filter((file) => !operationInfoFiles.has(file));
    const missing = files.filter((file) => !coverageText(fs.readFileSync(path.join(root, file), "utf8")).includes("operationInfos ?? []).toEqual([])"));

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

type ResponseFixtureKind = "chainedResponseWithOperationInfo" | "chainedResponseWithoutOperationInfo" | "lingeringSameCodeNegation";

function realScriptResponseFixtureFiles(): string[] {
  return [
    "lua-real-script-advanced-ritual-art-extra-material.test.ts",
    "lua-real-script-amaterasu-set-available-chain.test.ts",
    "lua-real-script-angineer-overlay-position.test.ts",
    "lua-real-script-aratama-spirit-search.test.ts",
    "lua-real-script-armor-blast-multi-target-free-chain.test.ts",
    "lua-real-script-bad-reaction-reverse-recover.test.ts",
    "lua-real-script-black-horn-special-summon-negate.test.ts",
    "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts",
    "lua-real-script-book-of-moon-free-chain.test.ts",
    "lua-real-script-bottomless-trap-hole-summon-success.test.ts",
    "lua-real-script-branded-fusion-deck-material.test.ts",
    "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts",
    "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts",
    "lua-real-script-called-by-the-grave.test.ts",
    "lua-real-script-castle-gate-release-cost-damage.test.ts",
    "lua-real-script-compulsory-evacuation-device-free-chain.test.ts",
    "lua-real-script-cosmic-cyclone-free-chain.test.ts",
    "lua-real-script-contract-dark-master-ritual-spell.test.ts",
    "lua-real-script-dark-bribe-negate-draw.test.ts",
    "lua-real-script-dark-dust-spirit-destroy.test.ts",
    "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts",
    "lua-real-script-des-wombat-no-effect-damage.test.ts",
    "lua-real-script-dicelops-toss-dice-restore.test.ts",
    "lua-real-script-dimensional-prison-battle-window.test.ts",
    "lua-real-script-divine-wrath-monster-negate.test.ts",
    "lua-real-script-dogmatikalamity-extra-ritual-lock.test.ts",
    "lua-real-script-draining-shield-battle-window.test.ts",
    "lua-real-script-droll-lock-bird-draw-search-lock.test.ts",
    "lua-real-script-earth-chant-ritual-equal.test.ts",
    "lua-real-script-equip-procedure-actions-part2.test.ts",
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions-part2.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-evocator-eveque-gemini-trigger.test.ts",
    "lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-fenghuang-set-backrow-destroy.test.ts",
    "lua-real-script-foolish-burial-deck-to-grave.test.ts",
    "lua-real-script-forbidden-arts-gishki-opponent-ritual.test.ts",
    "lua-real-script-fushi-no-tori-battle-recover.test.ts",
    "lua-real-script-future-samurai-gemini-banish-destroy.test.ts",
    "lua-real-script-gagaga-escape-position-lockout.test.ts",
    "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
    "lua-real-script-gemini-spark-release-destroy-draw.test.ts",
    "lua-real-script-ghost-ogre-chain-destroy.test.ts",
    "lua-real-script-gunkan-suship-catch-select-codes.test.ts",
    "lua-real-script-harpies-feather-duster-group-destroy.test.ts",
    "lua-real-script-hebo-spirit-grant-return.test.ts",
    "lua-real-script-heavy-polymerization-partial-extraop.test.ts",
    "lua-real-script-grand-horn-special-summon-negate.test.ts",
    "lua-real-script-horn-of-heaven-release-cost-negate.test.ts",
    "lua-real-script-high-ritual-art-deck-stage2.test.ts",
    "lua-real-script-hidden-armory-summon-set-lock.test.ts",
    "lua-real-script-herculean-power-gemini-hand-summon.test.ts",
    "lua-real-script-infinite-impermanence-target-param.test.ts",
    "lua-real-script-izanami-spirit-grave-return.test.ts",
    "lua-real-script-kinka-byo-relation-banish.test.ts",
    "lua-real-script-lightning-storm-select-effect.test.ts",
    "lua-real-script-machine-angel-absolute-grave-ritual.test.ts",
    "lua-real-script-magic-jammer-chain-negate.test.ts",
    "lua-real-script-magic-cylinder-battle-window.test.ts",
    "lua-real-script-magia-magic-select-effect.test.ts",
    "lua-real-script-magikey-duo-defense-ritual.test.ts",
    "lua-real-script-megalith-bethor-ritual-procedure.test.ts",
    "lua-real-script-megalith-unformed-deck-ritual.test.ts",
    "lua-real-script-miracle-fusion-extra-material.test.ts",
    "lua-real-script-miracle-raven-self-ritual.test.ts",
    "lua-real-script-mirror-force-battle-window.test.ts",
    "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts",
    "lua-real-script-monster-reborn-free-chain.test.ts",
    "lua-real-script-mutiny-sky-shuffle-fusion-material.test.ts",
    "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
    "lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
    "lua-real-script-nekroz-divinemirror-extra-deck-ritual.test.ts",
    "lua-real-script-negate-attack-battle-window.test.ts",
    "lua-real-script-omega-judgment-select-unselect-targets.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-otohime-position-overload.test.ts",
    "lua-real-script-phoenix-wing-wind-blast-discard-cost.test.ts",
    "lua-real-script-pot-of-desires-deck-cost.test.ts",
    "lua-real-script-pot-of-duality-excavate.test.ts",
    "lua-real-script-pot-of-extravagance-extra-cost.test.ts",
    "lua-real-script-pot-of-prosperity-excavate.test.ts",
    "lua-real-script-polymerization-fusion-summon.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-prayers-ritual-matfilter.test.ts",
    "lua-real-script-prime-material-dragon-reverse-damage.test.ts",
    "lua-real-script-primite-fusion-extra-check.test.ts",
    "lua-real-script-raigeki-group-destroy.test.ts",
    "lua-real-script-raigeki-break-discard-cost.test.ts",
    "lua-real-script-rasetsu-spirit-cost-return.test.ts",
    "lua-real-script-rebirth-nephthys-stage2.test.ts",
    "lua-real-script-reinforcement-of-the-army-search.test.ts",
    "lua-real-script-sakuretsu-armor-battle-window.test.ts",
    "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
    "lua-real-script-secrets-dark-magic-fusion-matcheck.test.ts",
    "lua-real-script-seven-tools-trap-negate.test.ts",
    "lua-real-script-shinobird-crow-damage-step-stat.test.ts",
    "lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
    "lua-real-script-shinobird-pigeon-spirit-return.test.ts",
    "lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
    "lua-real-script-solemn-judgment-summon-negate.test.ts",
    "lua-real-script-solemn-strike-special-summon-negate.test.ts",
    "lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
    "lua-real-script-solemn-warning-special-summon-effect-negate.test.ts",
    "lua-real-script-spirits-invitation-return-bounce.test.ts",
    "lua-real-script-super-soldier-synthesis-specific-material.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-thunder-sea-horse-special-lock.test.ts",
    "lua-real-script-threatening-roar-temporary-attack-lock.test.ts",
    "lua-real-script-totem-pole-change-damage.test.ts",
    "lua-real-script-torrential-tribute-summon-success.test.ts",
    "lua-real-script-trap-hole-summon-success.test.ts",
    "lua-real-script-tsukuyomi-position-trigger.test.ts",
    "lua-real-script-twin-twisters-discard-cost.test.ts",
    "lua-real-script-union-procedure-actions.test.ts",
    "lua-real-script-upstart-goblin-draw-recover.test.ts",
    "lua-real-script-waboku-temporary-battle-protection.test.ts",
    "lua-real-script-wiretap-trap-negate-to-deck.test.ts",
    "lua-real-script-yamato-no-kami-battle-destroy-backrow.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptChainedResponseFixtureFiles(): string[] {
  return realScriptResponseFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-called-by-the-grave.test.ts"));
}

function realScriptResponseOperationInfoFixtureFiles(): string[] {
  const responseWithoutOperationInfoFiles = new Set(responseWithoutOperationInfoFixtureFiles);
  return realScriptChainedResponseFixtureFiles()
    .filter((file) => !responseWithoutOperationInfoFiles.has(file));
}

function countResponseFixtureKinds(files: string[]): Record<ResponseFixtureKind, number> {
  const operationInfoFiles = new Set(realScriptResponseOperationInfoFixtureFiles());
  return files.reduce<Record<ResponseFixtureKind, number>>(
    (counts, file) => {
      counts[classifyResponseFixture(file, operationInfoFiles)] += 1;
      return counts;
    },
    {
      chainedResponseWithOperationInfo: 0,
      chainedResponseWithoutOperationInfo: 0,
      lingeringSameCodeNegation: 0,
    },
  );
}

function classifyResponseFixture(file: string, operationInfoFiles: Set<string>): ResponseFixtureKind {
  if (file.endsWith("lua-real-script-called-by-the-grave.test.ts")) {
    return "lingeringSameCodeNegation";
  }
  return operationInfoFiles.has(file) ? "chainedResponseWithOperationInfo" : "chainedResponseWithoutOperationInfo";
}
