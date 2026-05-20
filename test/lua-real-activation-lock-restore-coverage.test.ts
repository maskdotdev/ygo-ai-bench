import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const activationLockFixtureCount = 10;
const activationLockAllowListFixtureCount = 9;
const activationLockVariantFixtureCount = 17;
const activationLockInventoryFixtureCount = 21;
const activationLockVariantKindCounts = {
  attributeMonsterActivationLock: 6,
  cardActivationLock: 4,
  locationMonsterActivationLock: 1,
  nonSpiritMonsterActivationLock: 1,
  opponentEffectActivationLock: 2,
  spellCardActivationLock: 1,
  spellTrapEffectActivationLock: 1,
  trapCardActivationLock: 1,
} satisfies Record<ActivationLockVariantKind, number>;
const activationLockSemanticVariantCounts = {
  amanoIwatoNonSpiritMonsterLock: 1,
  ancientGearBeastAttackCardActivationLock: 1,
  blackGoatLaughsGraveSameCodeFieldMonsterLock: 1,
  aussaEarthChannelerAttributeLock: 1,
  coldWaveSpellTrapPredicateLock: 1,
  eriaWaterChannelerAttributeLock: 1,
  hiitaFireChannelerAttributeLock: 1,
  inzektorAxeDamagePhaseCardActivationLock: 1,
  lunalightKaleidoChickBattlePhaseOpponentLock: 1,
  mindDrainHandMonsterLocationLock: 1,
  sanganSameCodeSearchLock: 1,
  salesBanAnnounceSameCodeLock: 1,
  sasukeSamuraiSpellTrapNamedPredicateLock: 1,
  shopinaLightCostRegisteredAttributeLock: 1,
  sonicJammerSpellCardActivationLock: 1,
  timegazerTrapCardActivationLock: 1,
  ultimateFalconDetachAtkLossOpponentLock: 1,
  vernusylphSharedEarthAttributeLock: 1,
  wattgiraffeBattleDamageOpponentLock: 1,
  witchDefenseSameCodeSearchLock: 1,
  wynnWindChannelerAttributeLock: 1,
} satisfies Record<ActivationLockSemanticVariant, number>;

type ActivationLockVariantKind =
  | "attributeMonsterActivationLock"
  | "cardActivationLock"
  | "locationMonsterActivationLock"
  | "nonSpiritMonsterActivationLock"
  | "opponentEffectActivationLock"
  | "spellCardActivationLock"
  | "spellTrapEffectActivationLock"
  | "trapCardActivationLock";
type ActivationLockSemanticVariant =
  | "amanoIwatoNonSpiritMonsterLock"
  | "ancientGearBeastAttackCardActivationLock"
  | "blackGoatLaughsGraveSameCodeFieldMonsterLock"
  | "aussaEarthChannelerAttributeLock"
  | "coldWaveSpellTrapPredicateLock"
  | "eriaWaterChannelerAttributeLock"
  | "hiitaFireChannelerAttributeLock"
  | "inzektorAxeDamagePhaseCardActivationLock"
  | "lunalightKaleidoChickBattlePhaseOpponentLock"
  | "mindDrainHandMonsterLocationLock"
  | "sanganSameCodeSearchLock"
  | "salesBanAnnounceSameCodeLock"
  | "sasukeSamuraiSpellTrapNamedPredicateLock"
  | "shopinaLightCostRegisteredAttributeLock"
  | "sonicJammerSpellCardActivationLock"
  | "timegazerTrapCardActivationLock"
  | "ultimateFalconDetachAtkLossOpponentLock"
  | "vernusylphSharedEarthAttributeLock"
  | "wattgiraffeBattleDamageOpponentLock"
  | "witchDefenseSameCodeSearchLock"
  | "wynnWindChannelerAttributeLock";

describe("Lua real activation-lock restore coverage", () => {
  it("keeps the combined activation-lock restore fixture inventory explicit", () => {
    expect(combinedActivationLockFixtureFiles()).toHaveLength(activationLockInventoryFixtureCount);
    expect(combinedActivationLockFixtureFiles()).toEqual(realScriptActivationLockInventoryFiles());
  });

  it("requires representative activation-lock fixtures to assert clean Lua registry restore", () => {
    const files = realScriptActivationLockFixtureFiles();
    expect(files).toHaveLength(activationLockFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative activation-lock fixtures to prove restored lock effects and legal-action filtering", () => {
    const files = realScriptActivationLockFixtureFiles();
    expect(files).toHaveLength(activationLockFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("code === 6")
          || !text.includes('event: "continuous"')
          || !text.includes("targetRange")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("activateEffect")
          || !text.includes("toBe(false)");
      });

    expect(missing).toEqual([]);
  });

  it("requires activation-lock fixtures with exclusions to prove allowed actions remain legal", () => {
    const files = realScriptActivationLockAllowListFixtureFiles();
    expect(files).toHaveLength(activationLockAllowListFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("toBe(true)");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative activation-lock variants to prove exact blocked and allowed action classes", () => {
    const fixtures = realScriptActivationLockVariantFixtures();
    expect(fixtures).toHaveLength(activationLockVariantFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !fixture.requiredSnippets.every((snippet) => hasCoverageSnippet(text, snippet));
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });

  it("keeps activation-lock variant fixture kinds explicit", () => {
    expect(countActivationLockVariantKinds(realScriptActivationLockVariantFixtures())).toEqual(activationLockVariantKindCounts);
  });

  it("keeps named activation-lock semantic variants explicit", () => {
    expect(countActivationLockSemanticVariants(realScriptActivationLockSemanticVariants())).toEqual(activationLockSemanticVariantCounts);

    const weak = realScriptActivationLockSemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function combinedActivationLockFixtureFiles(): string[] {
  return [
    ...realScriptActivationLockFixtureFiles(),
    ...realScriptActivationLockAllowListFixtureFiles(),
    ...realScriptActivationLockVariantFixtures().map(({ file }) => file),
  ].filter((file, index, files) => files.indexOf(file) === index).sort();
}

function realScriptActivationLockInventoryFiles(): string[] {
  return [
    "lua-real-script-amano-iwato-activation-lock.test.ts",
    "lua-real-script-ancient-gear-beast-card-activation-lock.test.ts",
    "lua-real-script-aussa-channeler-attribute-activation-lock.test.ts",
    "lua-real-script-black-goat-laughs-announce-locks.test.ts",
    "lua-real-script-cold-wave-spelltrap-activation-lock.test.ts",
    "lua-real-script-eria-channeler-attribute-activation-lock.test.ts",
    "lua-real-script-hiita-channeler-attribute-activation-lock.test.ts",
    "lua-real-script-inzektor-axe-damage-phase-activation-lock.test.ts",
    "lua-real-script-lunalight-kaleido-chick-remove-activation-lock.test.ts",
    "lua-real-script-mind-drain-hand-monster-activation-lock.test.ts",
    "lua-real-script-sangan-same-code-activation-lock.test.ts",
    "lua-real-script-sales-ban-announce-activation-lock.test.ts",
    "lua-real-script-sasuke-samurai-spelltrap-activation-lock.test.ts",
    "lua-real-script-shopina-light-activation-lock.test.ts",
    "lua-real-script-sonic-jammer-spell-activation-lock.test.ts",
    "lua-real-script-timegazer-trap-activation-lock.test.ts",
    "lua-real-script-ultimate-falcon-activation-lock.test.ts",
    "lua-real-script-vernusylph-attribute-activation-lock.test.ts",
    "lua-real-script-wattgiraffe-battle-activation-lock.test.ts",
    "lua-real-script-witch-black-forest-same-code-activation-lock.test.ts",
    "lua-real-script-wynn-channeler-attribute-activation-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptActivationLockFixtureFiles(): string[] {
  return [
    "lua-real-script-amano-iwato-activation-lock.test.ts",
    "lua-real-script-ancient-gear-beast-card-activation-lock.test.ts",
    "lua-real-script-black-goat-laughs-announce-locks.test.ts",
    "lua-real-script-cold-wave-spelltrap-activation-lock.test.ts",
    "lua-real-script-mind-drain-hand-monster-activation-lock.test.ts",
    "lua-real-script-sangan-same-code-activation-lock.test.ts",
    "lua-real-script-sales-ban-announce-activation-lock.test.ts",
    "lua-real-script-timegazer-trap-activation-lock.test.ts",
    "lua-real-script-wattgiraffe-battle-activation-lock.test.ts",
    "lua-real-script-witch-black-forest-same-code-activation-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptActivationLockAllowListFixtureFiles(): string[] {
  return realScriptActivationLockFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-wattgiraffe-battle-activation-lock.test.ts"));
}

function realScriptActivationLockVariantFixtures(): Array<{
  file: string;
  kind: ActivationLockVariantKind;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-lunalight-kaleido-chick-remove-activation-lock.test.ts",
      kind: "opponentEffectActivationLock",
      requiredSnippets: [
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
        "effect.code === 6",
        "targetRange: [0, 1]",
        "action.uid === opponentSpell.uid)).toBe(false)",
        "action.uid === responder.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-falcon-activation-lock.test.ts",
      kind: "opponentEffectActivationLock",
      requiredSnippets: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
        "currentAttack(",
        "effect.code === 6",
        "targetRange: [0, 1]",
        "action.uid === responder.uid)).toBe(false)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-amano-iwato-activation-lock.test.ts",
      kind: "nonSpiritMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:non-spirit-monster-effect"',
        'action.uid === blockedMonster!.uid)).toBe(false)',
        'action.uid === allowedSpirit!.uid)',
        'host.messages).toContain("allowed Spirit resolved")',
        'host.messages).not.toContain("blocked monster resolved")',
      ],
    },
    {
      file: "test/lua-real-script-mind-drain-hand-monster-activation-lock.test.ts",
      kind: "locationMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:location-monster-effect:2"',
        "action.uid === handMonster.uid)).toBe(false)",
        "action.uid === graveMonster.uid)).toBe(true)",
        "action.uid === handSpell.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-aussa-channeler-attribute-activation-lock.test.ts",
      kind: "attributeMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:1"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === earthResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-inzektor-axe-damage-phase-activation-lock.test.ts",
      kind: "cardActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:card-activation"',
        'reset: { flags: 0x40000020 }',
        'action.uid === spell.uid)).toBe(false)',
        'action.uid === responder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-vernusylph-attribute-activation-lock.test.ts",
      kind: "attributeMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:1"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === earthResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-eria-channeler-attribute-activation-lock.test.ts",
      kind: "attributeMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:2"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === waterResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-hiita-channeler-attribute-activation-lock.test.ts",
      kind: "attributeMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:4"',
        'action.uid === windResponder.uid)).toBe(false)',
        'action.uid === fireResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-wynn-channeler-attribute-activation-lock.test.ts",
      kind: "attributeMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:8"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === windResponder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-beast-card-activation-lock.test.ts",
      kind: "cardActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:card-activation"',
        'targetRange: [0, 1]',
        'action.uid === opponentSpell.uid)).toBe(false)',
        'action.uid === responder.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-black-goat-laughs-announce-locks.test.ts",
      kind: "cardActivationLock",
      requiredSnippets: [
        'const blackGoatCode = "49299410"',
        "e2:SetCost(Cost.SelfBanish)",
        "e1:SetCode(EFFECT_CANNOT_ACTIVATE)",
        'luaValueDescriptor: "cannot-activate:same-code-monster-effect-location:4"',
        "targetRange: [1, 1]",
        "action.uid === p0Declared.uid)).toBe(false)",
        "action.uid === p1Declared.uid)).toBe(false)",
        "action.uid === p0Allowed.uid)).toBe(true)",
        "action.uid === p1Allowed.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-sales-ban-announce-activation-lock.test.ts",
      kind: "cardActivationLock",
      requiredSnippets: [
        'const salesBanCode = "64964750"',
        "Duel.AnnounceCard(tp)",
        "return re:GetHandler():IsOriginalCodeRule(e:GetLabel())",
        'luaValueDescriptor: "cannot-activate:same-code"',
        "targetRange: [0, 1]",
        "targetRange: [1, 0]",
        "reset: { flags: 0 }",
        "action.uid === p0Declared.uid)).toBe(false)",
        "action.uid === p1Declared.uid)).toBe(false)",
        "action.uid === p0Allowed.uid)).toBe(true)",
        "action.uid === p1Allowed.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-shopina-light-activation-lock.test.ts",
      kind: "attributeMonsterActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:16"',
        'action.uid === fireResponder.uid)).toBe(false)',
        'action.uid === lightResponder.uid)).toBe(true)',
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-sasuke-samurai-spelltrap-activation-lock.test.ts",
      kind: "spellTrapEffectActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:spell-trap-effect"',
        'action.uid === opponentSpell.uid)).toBe(false)',
        'action.uid === responder.uid)).toBe(true)',
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-sonic-jammer-spell-activation-lock.test.ts",
      kind: "spellCardActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:spell-card-activation"',
        'action.uid === spell.uid)).toBe(false)',
        'action.uid === trap.uid)).toBe(true)',
      ],
    },
    {
      file: "test/lua-real-script-timegazer-trap-activation-lock.test.ts",
      kind: "trapCardActivationLock",
      requiredSnippets: [
        'luaValueDescriptor: "cannot-activate:trap-card-activation"',
        'action.uid === spell.uid)).toBe(true)',
        'action.uid === trap.uid)).toBe(false)',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ActivationLockVariantKind;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function realScriptActivationLockSemanticVariants(): Array<{
  file: string;
  kind: ActivationLockSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-amano-iwato-activation-lock.test.ts",
      kind: "amanoIwatoNonSpiritMonsterLock",
      requiredSnippets: [
        'const amanoCode = "32181268"',
        "restores its field lock that blocks non-Spirit monster effects but allows Spirit effects",
        'luaValueDescriptor: "cannot-activate:non-spirit-monster-effect"',
        'action.uid === blockedMonster!.uid)).toBe(false)',
        'host.messages).toContain("allowed Spirit resolved")',
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-beast-card-activation-lock.test.ts",
      kind: "ancientGearBeastAttackCardActivationLock",
      requiredSnippets: [
        'const beastCode = "10509340"',
        "restores its attack-time card-activation lock while allowing monster effects",
        'luaValueDescriptor: "cannot-activate:card-activation"',
        "targetRange: [0, 1]",
        "action.uid === opponentSpell.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-black-goat-laughs-announce-locks.test.ts",
      kind: "blackGoatLaughsGraveSameCodeFieldMonsterLock",
      requiredSnippets: [
        'const blackGoatCode = "49299410"',
        "restores its grave self-banish announced on-field monster-effect activation lock",
        "Duel.AnnounceCard(tp,TYPE_MONSTER,OPCODE_ISTYPE)",
        "e2:SetCost(Cost.SelfBanish)",
        "e1:SetCode(EFFECT_CANNOT_ACTIVATE)",
        "_re:GetHandler():IsOriginalCodeRule(code) and _re:IsMonsterEffect() and _re:GetActivateLocation()==LOCATION_MZONE",
        'luaValueDescriptor: "cannot-activate:same-code-monster-effect-location:4"',
        "targetRange: [1, 1]",
        "action.uid === p0Declared.uid)).toBe(false)",
        "action.uid === p1Declared.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-aussa-channeler-attribute-activation-lock.test.ts",
      kind: "aussaEarthChannelerAttributeLock",
      requiredSnippets: [
        'const aussaCode = "62803464"',
        "restores its non-EARTH monster effect activation lock after the race-gated hand search",
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:1"',
        "action.uid === fireResponder.uid)).toBe(false)",
        "action.uid === earthResponder.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-cold-wave-spelltrap-activation-lock.test.ts",
      kind: "coldWaveSpellTrapPredicateLock",
      requiredSnippets: [
        'const coldWaveCode = "60682203"',
        "restores its predicate-valued lock that blocks Spell/Trap effects",
        'luaValueDescriptor: "cannot-activate:spell-trap-effect"',
        "targetRange: [1, 1]",
        "cold wave responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-eria-channeler-attribute-activation-lock.test.ts",
      kind: "eriaWaterChannelerAttributeLock",
      requiredSnippets: [
        'const eriaCode = "15746348"',
        "restores its non-WATER monster effect activation lock after the hand search",
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:2"',
        "action.uid === fireResponder.uid)).toBe(false)",
        "action.uid === waterResponder.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-hiita-channeler-attribute-activation-lock.test.ts",
      kind: "hiitaFireChannelerAttributeLock",
      requiredSnippets: [
        'const hiitaCode = "76615300"',
        "restores its non-FIRE monster effect activation lock after the hand search",
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:4"',
        "action.uid === windResponder.uid)).toBe(false)",
        "action.uid === fireResponder.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-inzektor-axe-damage-phase-activation-lock.test.ts",
      kind: "inzektorAxeDamagePhaseCardActivationLock",
      requiredSnippets: [
        'const axeCode = "87973893"',
        "restores its attack-announcement card activation lock until the Damage Step",
        'luaValueDescriptor: "cannot-activate:card-activation"',
        "reset: { flags: 0x40000020 }",
        "action.uid === spell.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-lunalight-kaleido-chick-remove-activation-lock.test.ts",
      kind: "lunalightKaleidoChickBattlePhaseOpponentLock",
      requiredSnippets: [
        'const kaleidoCode = "35618217"',
        "restores its banish trigger and battle-phase static cannot-activate lock",
        "kaleido banish 1",
        "targetRange: [0, 1]",
        "action.uid === opponentSpell.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-mind-drain-hand-monster-activation-lock.test.ts",
      kind: "mindDrainHandMonsterLocationLock",
      requiredSnippets: [
        'const mindDrainCode = "68937720"',
        "restores its LP-cost hand monster-effect activation lock while allowing grave monster effects",
        'luaValueDescriptor: "cannot-activate:location-monster-effect:2"',
        "lifePoints).toBe(7000)",
        "action.uid === handMonster.uid)).toBe(false)",
        "action.uid === graveMonster.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-sangan-same-code-activation-lock.test.ts",
      kind: "sanganSameCodeSearchLock",
      requiredSnippets: [
        'const sanganCode = "26202165"',
        "restores its searched-card same-code activation lock",
        'luaValueDescriptor: "cannot-activate:same-code"',
        "targetRange: [1, 0]",
        "action.uid === searched.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-sales-ban-announce-activation-lock.test.ts",
      kind: "salesBanAnnounceSameCodeLock",
      requiredSnippets: [
        'const salesBanCode = "64964750"',
        "restores its announced same-original-code activation locks for both players",
        "Duel.AnnounceCard(tp)",
        "return re:GetHandler():IsOriginalCodeRule(e:GetLabel())",
        'luaValueDescriptor: "cannot-activate:same-code"',
        "targetRange: [0, 1]",
        "targetRange: [1, 0]",
        "action.uid === p0Declared.uid)).toBe(false)",
        "action.uid === p1Declared.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-sasuke-samurai-spelltrap-activation-lock.test.ts",
      kind: "sasukeSamuraiSpellTrapNamedPredicateLock",
      requiredSnippets: [
        'const sasukeCode = "11760174"',
        "restores its LP-cost Spell/Trap activation lock from a named predicate",
        'luaValueDescriptor: "cannot-activate:spell-trap-effect"',
        "action.uid === opponentSpell.uid)).toBe(false)",
        "action.uid === responder.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-shopina-light-activation-lock.test.ts",
      kind: "shopinaLightCostRegisteredAttributeLock",
      requiredSnippets: [
        'const shopinaCode = "5908650"',
        "restores its cost-registered non-LIGHT monster effect activation lock",
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:16"',
        "action.uid === fireResponder.uid)).toBe(false)",
        "action.uid === lightResponder.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-sonic-jammer-spell-activation-lock.test.ts",
      kind: "sonicJammerSpellCardActivationLock",
      requiredSnippets: [
        'const jammerCode = "84550200"',
        "restores its Spell Card activation lock while allowing Trap activations",
        'luaValueDescriptor: "cannot-activate:spell-card-activation"',
        "action.uid === spell.uid)).toBe(false)",
        "action.uid === trap.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-timegazer-trap-activation-lock.test.ts",
      kind: "timegazerTrapCardActivationLock",
      requiredSnippets: [
        'const timegazerCode = "20409757"',
        "restores its Trap Card activation lock while allowing Spell activations",
        'luaValueDescriptor: "cannot-activate:trap-card-activation"',
        "action.uid === spell.uid)).toBe(true)",
        "action.uid === trap.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-falcon-activation-lock.test.ts",
      kind: "ultimateFalconDetachAtkLossOpponentLock",
      requiredSnippets: [
        'const falconCode = "86221741"',
        "restores its detach cost, opponent ATK loss, and cannot-activate lock",
        "currentAttack(",
        "targetRange: [0, 1]",
        "action.uid === responder.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-vernusylph-attribute-activation-lock.test.ts",
      kind: "vernusylphSharedEarthAttributeLock",
      requiredSnippets: [
        'const hillsCode = "9350312"',
        "restores the shared helper's non-EARTH monster effect activation lock",
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:1"',
        "action.uid === fireResponder.uid)).toBe(false)",
        "action.uid === earthResponder.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-wattgiraffe-battle-activation-lock.test.ts",
      kind: "wattgiraffeBattleDamageOpponentLock",
      requiredSnippets: [
        'const wattgiraffeCode = "402568"',
        "restores its direct-battle-damage static cannot-activate lock",
        "targetRange: [0, 1]",
        "action.uid === opponentSpell.uid)).toBe(false)",
        "action.uid === responder.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-witch-black-forest-same-code-activation-lock.test.ts",
      kind: "witchDefenseSameCodeSearchLock",
      requiredSnippets: [
        'const witchCode = "78010363"',
        "restores its Defense-filtered search into a same-code activation lock",
        "return c:IsDefenseBelow(1500) and c:IsMonster() and c:IsAbleToHand()",
        'luaValueDescriptor: "cannot-activate:same-code"',
        "targetRange: [1, 0]",
        "action.uid === searched.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-wynn-channeler-attribute-activation-lock.test.ts",
      kind: "wynnWindChannelerAttributeLock",
      requiredSnippets: [
        'const wynnCode = "86395581"',
        "restores its non-WIND monster effect activation lock after the hand search",
        'luaValueDescriptor: "cannot-activate:monster-attribute-except:8"',
        "action.uid === fireResponder.uid)).toBe(false)",
        "action.uid === windResponder.uid)).toBe(true)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ActivationLockSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countActivationLockSemanticVariants(
  fixtures: Array<{ kind: ActivationLockSemanticVariant }>,
): Record<ActivationLockSemanticVariant, number> {
  return fixtures.reduce<Record<ActivationLockSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      amanoIwatoNonSpiritMonsterLock: 0,
      ancientGearBeastAttackCardActivationLock: 0,
      aussaEarthChannelerAttributeLock: 0,
      blackGoatLaughsGraveSameCodeFieldMonsterLock: 0,
      coldWaveSpellTrapPredicateLock: 0,
      eriaWaterChannelerAttributeLock: 0,
      hiitaFireChannelerAttributeLock: 0,
      inzektorAxeDamagePhaseCardActivationLock: 0,
      lunalightKaleidoChickBattlePhaseOpponentLock: 0,
      mindDrainHandMonsterLocationLock: 0,
      sanganSameCodeSearchLock: 0,
      salesBanAnnounceSameCodeLock: 0,
      sasukeSamuraiSpellTrapNamedPredicateLock: 0,
      shopinaLightCostRegisteredAttributeLock: 0,
      sonicJammerSpellCardActivationLock: 0,
      timegazerTrapCardActivationLock: 0,
      ultimateFalconDetachAtkLossOpponentLock: 0,
      vernusylphSharedEarthAttributeLock: 0,
      wattgiraffeBattleDamageOpponentLock: 0,
      witchDefenseSameCodeSearchLock: 0,
      wynnWindChannelerAttributeLock: 0,
    },
  );
}

function countActivationLockVariantKinds(
  fixtures: Array<{ kind: ActivationLockVariantKind }>,
): Record<ActivationLockVariantKind, number> {
  return fixtures.reduce<Record<ActivationLockVariantKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attributeMonsterActivationLock: 0,
      cardActivationLock: 0,
      locationMonsterActivationLock: 0,
      nonSpiritMonsterActivationLock: 0,
      opponentEffectActivationLock: 0,
      spellCardActivationLock: 0,
      spellTrapEffectActivationLock: 0,
      trapCardActivationLock: 0,
    },
  );
}
