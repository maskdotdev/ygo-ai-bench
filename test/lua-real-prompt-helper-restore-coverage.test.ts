import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const scannerPath = path.join(root, "tools/scan-lua-prompt-patterns.mjs");
const upstreamOfficialScriptRoot = path.join(root, ".upstream/ignis/script/official");

const officialPromptScannerSummary = {
  filesWithCalls: 1957,
  promptCalls: 2458,
  announcementCalls: 247,
  unclassifiedPromptCalls: 0,
};

const officialPromptApiCounts: Record<string, number> = {
  SelectOption: 437,
  SelectYesNo: 1172,
  SelectEffect: 352,
  SelectEffectYesNo: 250,
  AnnounceNumber: 58,
  AnnounceNumberRange: 24,
  AnnounceCard: 33,
  AnnounceType: 0,
  AnnounceRace: 24,
  AnnounceAttribute: 33,
  AnnounceLevel: 29,
  SelectCardsFromCodes: 1,
  SelectDisableField: 41,
  SelectField: 0,
  SelectFieldZone: 4,
};

const officialPromptApisWithoutOfficialUsage = ["AnnounceType", "SelectField"].sort();
const officialPromptApisWithOfficialUsage = Object.entries(officialPromptApiCounts)
  .filter(([, count]) => count > 0)
  .map(([api]) => api)
  .sort();

const officialPromptPatternCounts: Record<string, number> = {
  "SelectYesNo:description": 1172,
  "SelectOption:literal-options": 416,
  "SelectEffect:effect-table-options": 349,
  "SelectEffectYesNo:description": 250,
  "SelectDisableField:zone-mask": 41,
  "AnnounceNumber:table-unpack": 39,
  "AnnounceAttribute:literal-options": 33,
  "AnnounceLevel:literal-options": 26,
  "AnnounceNumberRange:literal-options": 24,
  "AnnounceRace:literal-options": 24,
  "AnnounceNumber:literal-options": 19,
  "SelectOption:table-unpack": 19,
  "AnnounceCard:table-unpack": 18,
  "AnnounceCard:literal-options": 8,
  "AnnounceCard:default": 7,
  "SelectFieldZone:zone-mask": 4,
  "AnnounceLevel:default": 3,
  "SelectEffect:dynamic-options": 3,
  "SelectCardsFromCodes:code-literals": 1,
  "SelectOption:leading-boolean-literals": 1,
  "SelectOption:leading-boolean-table-unpack": 1,
};

const promptHelperKindCounts: Record<PromptHelperKind, number> = {
  announceCardSummonLock: 1,
  announceLevelStatChange: 1,
  announceNumberCost: 1,
  announceNumberRangeToken: 1,
  announceTraitHandShuffle: 1,
  selectCardsFromCodesSearch: 1,
  selectDisableFieldLoop: 1,
  selectDisableFieldMovement: 2,
  selectEffectModeChoice: 4,
  selectEffectYesNoReplacement: 1,
  selectFieldZoneLoop: 1,
  selectFieldZoneMirrorSummon: 1,
  selectFieldZoneTarget: 1,
  selectOptionFieldZone: 1,
  selectOptionRitualBranch: 2,
  selectOptionTurnEffect: 1,
  selectYesNoActivationLock: 1,
};

describe("Lua real prompt helper restore coverage", () => {
  it.skipIf(!fs.existsSync(upstreamOfficialScriptRoot))("pins the official prompt helper scanner corpus", () => {
    const report = JSON.parse(execFileSync(process.execPath, [scannerPath, "--scripts", upstreamOfficialScriptRoot, "--json"], { encoding: "utf8" }));

    expect(report).toMatchObject(officialPromptScannerSummary);
    expect(report.apiCounts).toEqual(officialPromptApiCounts);
    expect(report.patternCounts).toEqual(officialPromptPatternCounts);
  });

  it("keeps zero-use official prompt APIs covered by browser prompt shims", () => {
    const zeroUseApis = Object.entries(officialPromptApiCounts)
      .filter(([, count]) => count === 0)
      .map(([api]) => api)
      .sort();

    expect(zeroUseApis).toEqual(officialPromptApisWithoutOfficialUsage);

    const shimTelemetryText = fs.readFileSync(path.join(root, "test/lua-prompt-shim-telemetry.test.ts"), "utf8");
    const scannerText = fs.readFileSync(path.join(root, "test/lua-prompt-pattern-scanner.test.ts"), "utf8");
    const publicApiText = fs.readFileSync(path.join(root, "test/public-api.test.ts"), "utf8");

    const missingShimCoverage = zeroUseApis.filter((api) =>
      !shimTelemetryText.includes(`api: "${api}"`)
      || !shimTelemetryText.includes(`Duel.${api}`)
      || !scannerText.includes(`Duel.${api}`)
      || !publicApiText.includes(`"${api}"`)
    );

    expect(missingShimCoverage).toEqual([]);
  });

  it("keeps the representative prompt helper fixture inventory broad", () => {
    expect(representativePromptHelperFixtures()).toHaveLength(22);
  });

  it("keeps every officially-used prompt API represented by restore fixtures", () => {
    const representedApis = [...new Set(representativePromptHelperFixtures().flatMap(({ apis }) => apis))].sort();

    expect(representedApis).toEqual(officialPromptApisWithOfficialUsage);
  });

  it("keeps representative prompt helper fixture kinds explicit", () => {
    expect(countPromptHelperKinds(representativePromptHelperFixtures())).toEqual(promptHelperKindCounts);
  });

  it("requires representative prompt helper fixtures to assert clean Lua restore", () => {
    const missing = representativePromptHelperFixtures()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative prompt helper fixtures to prove restored grouped legal actions", () => {
    const missing = representativePromptHelperFixtures()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative prompt helper fixtures to prove restored prompt semantics", () => {
    const weak = representativePromptHelperFixtures()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });
});

type OfficialPromptApi = keyof typeof officialPromptApiCounts;
type PromptHelperKind =
  | "announceCardSummonLock"
  | "announceLevelStatChange"
  | "announceNumberCost"
  | "announceNumberRangeToken"
  | "announceTraitHandShuffle"
  | "selectCardsFromCodesSearch"
  | "selectDisableFieldLoop"
  | "selectDisableFieldMovement"
  | "selectEffectModeChoice"
  | "selectEffectYesNoReplacement"
  | "selectFieldZoneLoop"
  | "selectFieldZoneMirrorSummon"
  | "selectFieldZoneTarget"
  | "selectOptionFieldZone"
  | "selectOptionRitualBranch"
  | "selectOptionTurnEffect"
  | "selectYesNoActivationLock";

function representativePromptHelperFixtures(): Array<{ file: string; kind: PromptHelperKind; apis: OfficialPromptApi[]; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-gunkan-suship-catch-select-codes.test.ts",
      kind: "selectCardsFromCodesSearch",
      apis: ["SelectCardsFromCodes"],
      required: [
        "restores the opponent code-selection prompt into the chosen Suship search",
        'api: "SelectCardsFromCodes"',
        "options: [Number(sushipIkuraCode), Number(sushipUniCode), Number(sushipShirauoCode)]",
        "returned: Number(sushipIkuraCode)",
        "expect(restored.session.state.chain).toHaveLength(0)",
        'location: "hand"',
        'expect(restored.host.messages).not.toContain("gunkan suship responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-gishki-psychelone-announce-traits.test.ts",
      kind: "announceTraitHandShuffle",
      apis: ["AnnounceAttribute", "AnnounceRace"],
      required: [
        "restores announced race and attribute labels into the opponent hand shuffle",
        'api: "AnnounceRace"',
        'api: "AnnounceAttribute"',
        "effectLabel: raceWarrior",
        "effectLabels: [raceWarrior, attributeEarth]",
        'card?.location === "deck"',
        'expect(restored.host.messages).not.toContain("gishki psychelone responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-gagaga-magician-announce-level.test.ts",
      kind: "announceLevelStatChange",
      apis: ["AnnounceLevel"],
      required: [
        "restores announced level label into the temporary level change",
        'api: "AnnounceLevel"',
        "options: [1, 2, 3, 5, 6, 7, 8]",
        "effectLabel: 1",
        "currentLevel(restoredGagaga, restored.session.state)).toBe(1)",
        'expect(restored.host.messages).not.toContain("gagaga magician responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-gachi-gachi-select-effect-yes-no.test.ts",
      kind: "selectEffectYesNoReplacement",
      apis: ["SelectEffectYesNo"],
      required: [
        "restores SelectEffectYesNo destroy replacement into Xyz material detach",
        'api: "SelectEffectYesNo"',
        "description: 96",
        "reason: duelReason.effect",
        "location: \"graveyard\"",
      ],
    },
    {
      file: "test/lua-real-script-inferno-ashened-field-zone-option.test.ts",
      kind: "selectOptionFieldZone",
      apis: ["SelectOption"],
      required: [
        "restores a leading-false SelectOption branch that places Obsidim in the opponent Field Zone",
        "descriptions: [fieldZoneOptionDescription, opponentFieldZoneOptionDescription]",
        'location: "spellTrapZone"',
        'controller: 1',
        'expect(restored.host.messages).not.toContain("inferno ashened responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-primite-lordly-lode.test.ts",
      kind: "announceCardSummonLock",
      apis: ["AnnounceCard"],
      required: [
        "restores dynamic AnnounceCard into the declared Normal Monster summon and effect lock",
        "targetParam: Number(darkMagicianCode)",
        'position: "faceUpDefense"',
        "cannot-activate:special-summoned-monster-on-field",
      ],
    },
    {
      file: "test/lua-real-script-pyro-clock-select-option-table-unpack.test.ts",
      kind: "selectOptionTurnEffect",
      apis: ["SelectOption"],
      required: [
        "restores table-unpacked SelectOption into the selected turn-count effect operation",
        'api: "SelectOption"',
        "options: [0, 1]",
        "descriptions: [801, 802]",
        "returned: 0",
        'expect(restored.host.messages).toContain("pyro clock selected first turn effect")',
      ],
    },
    {
      file: "test/lua-real-script-primathmech-laplacian-dynamic-select-effect.test.ts",
      kind: "selectEffectModeChoice",
      apis: ["SelectEffect"],
      required: [
        "restores table-unpacked SelectEffect choices from its Xyz Summon trigger",
        'api: "SelectEffect"',
        "options: [1, 2, 3]",
        "returned: 1",
        'triggerBucket: "turnOptional"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-laval-blaster-announce-number.test.ts",
      kind: "announceNumberCost",
      apis: ["AnnounceNumber"],
      required: [
        "restores dynamic AnnounceNumber deck-discard cost into its ATK boost",
        "currentAttack(restoredBlaster, restoredChainWindow.session.state)).toBe((lavalBlaster!.data.attack ?? 0) + 1000)",
        'expect(restoredChainWindow.host.messages).not.toContain("laval blaster responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-lightning-storm-select-effect.test.ts",
      kind: "selectEffectModeChoice",
      apis: ["SelectEffect"],
      required: [
        "restores Lightning Storm's selected attack-position monster destroy mode",
        "restores Lightning Storm's selected Spell/Trap destroy mode",
        "effectLabel: 1",
        "effectLabel: 2",
        'expect(host.messages).not.toContain("lightning storm responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-duo-defense-ritual.test.ts",
      kind: "selectOptionRitualBranch",
      apis: ["SelectOption"],
      required: [
        "restores a target-returning Ritual.Operation branch with sumpos face-up Defense",
        "descriptions: [returnOptionDescription, ritualOptionDescription]",
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        'expect(restored.host.messages).not.toContain("magikey duo responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-maftea-deck-ritual.test.ts",
      kind: "selectOptionRitualBranch",
      apis: ["SelectOption"],
      required: [
        "restores non-sentinel SelectOption into Ritual extra material extraop",
        "descriptions: [ritualOptionDescription]",
        "summonMaterialUids).toEqual([handMaterial!.uid, faceupNormal!.uid, deckNormalMaterial!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("magikey maftea responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magia-magic-select-effect.test.ts",
      kind: "selectEffectModeChoice",
      apis: ["SelectEffect"],
      required: [
        "restores multi-option SelectEffect into Magia Magic's Special Summon branch",
        'api: "SelectEffect"',
        "options: [1, 2]",
        "effectLabel: 1",
        "summonType: \"special\"",
        'expect(restored.host.messages).not.toContain("magia magic responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-mirror-mage-announce-number-range.test.ts",
      kind: "announceNumberRangeToken",
      apis: ["AnnounceNumberRange"],
      required: [
        "restores announced token count into token summons and level update",
        'api: "AnnounceNumberRange"',
        "options: [1, 2, 3]",
        "currentLevel(restoredMirrorMage, restored.session.state)).toBe((mirrorMage.data.level ?? 0) + 1)",
        "card.code === iceBarrierTokenCode && card.location === \"monsterZone\"",
        'expect(restored.host.messages).not.toContain("mirror mage responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-naturia-blessing-select-effect.test.ts",
      kind: "selectEffectModeChoice",
      apis: ["SelectEffect"],
      required: [
        "restores selected SelectEffect branch into the Naturia Special Summon operation",
        'api: "SelectEffect"',
        "options: [1]",
        "summonType: \"special\"",
        "getLuaRestoreLegalActionGroups(restored, 0)",
      ],
    },
    {
      file: "test/lua-real-script-springans-ship-select-field-zone.test.ts",
      kind: "selectFieldZoneTarget",
      apis: ["SelectFieldZone"],
      required: [
        "restores Exblowrer's selected opponent field zone chain label",
        'api: "SelectFieldZone"',
        "returned: 1 << 18",
        'location: "graveyard"',
        "overlayUids: []",
        'expect(restored.host.messages).not.toContain("springans ship responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-springans-blast-field-zone-loop.test.ts",
      kind: "selectFieldZoneLoop",
      apis: ["SelectFieldZone", "SelectYesNo"],
      required: [
        "restores repeated SelectFieldZone prompts with the first selected zone filtered out",
        'api: "SelectFieldZone"',
        'api: "SelectYesNo"',
        "options: [1 << 16, 2 << 16, 4 << 16, 8 << 16, 16 << 16]",
        "options: [2 << 16, 4 << 16, 8 << 16, 16 << 16]",
        "effectLabels: [",
        "disabledFieldEffects.map((effect) => effect.value)).toEqual([1 << 16, 2 << 16])",
      ],
    },
    {
      file: "test/lua-real-script-small-scuffle-mirrored-zone-summon.test.ts",
      kind: "selectFieldZoneMirrorSummon",
      apis: ["SelectFieldZone", "SelectYesNo"],
      required: [
        "restores SelectFieldZone target param into mirrored Special Summon zones",
        'api: "SelectFieldZone"',
        'api: "SelectYesNo"',
        "options: [1, 2, 4, 8, 16]",
        '"targetParam": 1',
        "sequence: 0, position: \"faceUpAttack\"",
        "sequence: 4, position: \"faceUpAttack\"",
      ],
    },
    {
      file: "test/lua-real-script-spring-multi-disable-zone.test.ts",
      kind: "selectDisableFieldLoop",
      apis: ["SelectDisableField", "SelectYesNo"],
      required: [
        "restores repeated SelectDisableField and SelectYesNo prompts into Season Counter placement",
        'api: "SelectDisableField"',
        'api: "SelectYesNo"',
        "options: [2, 4, 8, 16]",
        "options: [16]",
        "getDuelCardCounter(restoredSpring, counterSeason)).toBe(5)",
        'expect(restored.host.messages).not.toContain("spring responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-sprind-select-disable-field.test.ts",
      kind: "selectDisableFieldMovement",
      apis: ["SelectDisableField"],
      required: [
        "restores the selected disabled-field zone into the column movement operation",
        'api: "SelectDisableField"',
        "options: [1, 8, 16]",
        "sequence: 0",
        'expect(restored.host.messages).not.toContain("sprind responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-wattkinetic-puppeteer-opponent-zone-move.test.ts",
      kind: "selectDisableFieldMovement",
      apis: ["SelectDisableField"],
      required: [
        "restores opponent-zone SelectDisableField into the shifted MoveSequence operation",
        'api: "SelectDisableField"',
        "options: [1 << 16, 2 << 16, 8 << 16, 16 << 16]",
        "returned: 1 << 16",
        "sequence: 0",
        'expect(restored.host.messages).not.toContain("wattkinetic responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-vernusylph-attribute-activation-lock.test.ts",
      kind: "selectYesNoActivationLock",
      apis: ["SelectYesNo"],
      required: [
        "restores the shared helper's non-EARTH monster effect activation lock",
        'expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true })',
        "cannot-activate:monster-attribute-except:1",
        "expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === \"activateEffect\" && action.uid === fireResponder.uid)).toBe(false)",
      ],
    },
  ] satisfies Array<{ file: string; kind: PromptHelperKind; apis: OfficialPromptApi[]; required: string[] }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPromptHelperKinds(fixtures: Array<{ kind: PromptHelperKind }>): Record<PromptHelperKind, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(promptHelperKindCounts).map((kind) => [kind, 0])) as Record<PromptHelperKind, number>,
  );
}
