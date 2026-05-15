import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const SPECIAL_SUMMON_LOCK_FIXTURE_COUNT = 69;
const SAME_CODE_EXTRA_DECK_ONCE_LOCK_FIXTURE_COUNT = 2;

describe("Lua real special-summon lock restore coverage", () => {
  it("requires representative special-summon lock fixtures to assert clean Lua restore", () => {
    const fixtures = representativeSpecialSummonLockFixtures();
    expect(fixtures).toHaveLength(SPECIAL_SUMMON_LOCK_FIXTURE_COUNT);

    const missing = fixtures
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions");
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });

  it("requires representative special-summon lock fixtures to prove blocked and allowed restored summon operations", () => {
    const fixtures = representativeSpecialSummonLockFixtures();
    expect(fixtures).toHaveLength(SPECIAL_SUMMON_LOCK_FIXTURE_COUNT);

    const weak = fixtures
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !fixture.requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });

  it("requires same-code Extra Deck once-lock fixtures to assert clean Lua restore and allowed alternatives", () => {
    const fixtures = representativeSameCodeExtraDeckOnceLockFixtures();
    expect(fixtures).toHaveLength(SAME_CODE_EXTRA_DECK_ONCE_LOCK_FIXTURE_COUNT);

    const missing = fixtures
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !fixture.requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });
});

function representativeSpecialSummonLockFixtures(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-satellarknight-zefrathuban-pendulum-setcode-lock.test.ts",
      requiredSnippets: [
        "target:pendulum-summon-not-setcode:",
        "zefrathuban tellarknight pendulum special 1",
        "zefrathuban zefra pendulum special 1",
        "zefrathuban generic pendulum special 0",
        "zefrathuban regular special 1",
      ],
    },
    {
      file: "test/lua-real-script-numen-erat-testudo-attack-summon-lock.test.ts",
      requiredSnippets: [
        "target:attack-below:1800",
        "testudo low special 0",
        "testudo equal special 0",
        "testudo high special 1",
      ],
    },
    {
      file: "test/lua-real-script-fallen-angel-fusion-alternate-once-lock.test.ts",
      requiredSnippets: [
        "target:summon-type-code-any:current:",
        "fallen fusion special 0",
        "fallen alternate special 0",
        "other fusion special 1",
      ],
    },
    {
      file: "test/lua-real-script-fire-prison-field-max-link-lock.test.ts",
      requiredSnippets: [
        "target:link-summon-below-field-max-link",
        "fire prison link2 link special 0",
        "fire prison link3 link special 1",
        "fire prison link4 link special 1",
        "fire prison fusion special 1",
      ],
    },
    {
      file: "test/lua-real-script-repair-genex-controller-procedure-extra-lock.test.ts",
      requiredSnippets: [
        "target:extra-summon-type-not-or-no-procedure:",
        "canPlayerSpecialSummon(restored.session.state, 0, synchro, luaSummonTypeSynchro, procedureEffectId)).toBe(true)",
        "canPlayerSpecialSummon(restored.session.state, 0, synchro, luaSummonTypeSynchro)).toBe(false)",
        "repair genex raw synchro special 0",
        "repair genex fusion special 0",
      ],
    },
    {
      file: "test/lua-real-script-rokket-barrage-extra-dark-lock.test.ts",
      requiredSnippets: [
        "special-summon-limit:not-attribute-extra:32",
        "rokket barrage fire extra special 0",
        "rokket barrage dark extra special 1",
        "rokket barrage deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-stellarnova-bonds-extra-xyz-lock.test.ts",
      requiredSnippets: [
        "special-summon-limit:not-type-extra:8388608",
        "stellarnova fusion special 0",
        "stellarnova synchro special 0",
        "stellarnova xyz special 1",
        "stellarnova deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-welcome-labrynth-fiend-deck-extra-lock.test.ts",
      requiredSnippets: [
        "special-summon-limit:not-race-deck-or-extra:8",
        "welcome labrynth fiend deck special 1",
        "welcome labrynth warrior deck special 0",
        "welcome labrynth fiend extra special 1",
        "welcome labrynth warrior extra special 0",
      ],
    },
    {
      file: "test/lua-real-script-eldlixir-zombie-special-lock.test.ts",
      requiredSnippets: [
        "Duel.IsPlayerCanSpecialSummon",
        "eldlixir can special locked true/false",
        "eldlixir warrior special locked 0",
        "eldlixir zombie special locked 1",
      ],
    },
    {
      file: "test/lua-real-script-drytron-nu2-ritual-machine-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: `target:ritual-summon-not-race:${raceMachine}`',
        "drytron machine ritual special 1",
        "drytron dragon ritual special 0",
        "drytron dragon regular special 1",
      ],
    },
    {
      file: "test/lua-real-script-lunalight-wolf-pendulum-monster-lock.test.ts",
      requiredSnippets: [
        "target:pendulum-summon-not-setcode-monster:",
        "wolf lunalight pendulum special 1",
        "wolf generic pendulum special 0",
        "wolf regular special 1",
      ],
    },
    {
      file: "test/lua-real-script-couplet-pendulum-light-lock.test.ts",
      requiredSnippets: [
        "target:pendulum-summon-not-attribute:",
        "couplet light pendulum special 1",
        "couplet dark pendulum special 0",
        "couplet dark regular special 1",
      ],
    },
    {
      file: "test/lua-real-script-jam-breeding-machine-slime-token-lock.test.ts",
      requiredSnippets: [
        "target:not-code:",
        "Duel.CreateToken",
        "jam slime token special 1",
        "jam hand special 0",
      ],
    },
    {
      file: "test/lua-real-script-cyanos-extra-machine-lock.test.ts",
      requiredSnippets: [
        "cyanos warrior extra special 0",
        "cyanos machine extra special 1",
        "cyanos warrior hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-karakuri-bonze-extra-earth-machine-lock.test.ts",
      requiredSnippets: [
        "special-summon-limit:not-attribute-race-extra:1:32",
        "karakuri dark machine special 0",
        "karakuri earth warrior special 0",
        "karakuri earth machine special 1",
        "karakuri deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-chimera-doll-extra-machine-xyz-lock.test.ts",
      requiredSnippets: [
        "special-summon-limit:not-type-race-extra:8388608:32",
        "chimera warrior xyz special 0",
        "chimera machine fusion special 0",
        "chimera machine xyz special 1",
        "chimera hand warrior special 1",
      ],
    },
    {
      file: "test/lua-real-script-smiger-extra-machine-synchro-lock.test.ts",
      requiredSnippets: [
        "smiger warrior synchro special 0",
        "smiger machine fusion special 0",
        "smiger machine synchro special 1",
        "smiger hand warrior special 1",
      ],
    },
    {
      file: "test/lua-real-script-wildwind-extra-synchro-lock.test.ts",
      requiredSnippets: [
        "wildwind fusion special 0",
        "wildwind hand special 1",
        "wildwind synchro special 1",
      ],
    },
    {
      file: "test/lua-real-script-world-legacy-cliffhanger-link-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: `target:special-summon-type-is:${luaSummonTypeLink}`',
        "targetRange: [1, 1]",
        "cliffhanger link special 0",
        "cliffhanger fusion special 1",
        "cliffhanger hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-vata-extra-dark-lock.test.ts",
      requiredSnippets: [
        "vata extra light special 0",
        "vata hand light special 1",
        "vata extra dark special 1",
      ],
    },
    {
      file: "test/lua-real-script-white-sardine-extra-water-lock.test.ts",
      requiredSnippets: [
        "white sardine dark extra special 0",
        "white sardine water extra special 1",
        "white sardine deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-wish-dragon-extra-level5-dragon-lock.test.ts",
      requiredSnippets: [
        "wish level4 dragon special 0",
        "wish level5 warrior special 0",
        "wish level5 dragon special 1",
        "wish level6 dragon special 1",
      ],
    },
    {
      file: "test/lua-real-script-windwitch-ice-bell-extra-level5-wind-lock.test.ts",
      requiredSnippets: [
        "ice bell level4 wind special 0",
        "ice bell level5 earth special 0",
        "ice bell level5 wind special 1",
        "ice bell deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-vengeful-witch-extra-synchro-lock.test.ts",
      requiredSnippets: [
        "vengeful witch fusion special 0",
        "vengeful witch xyz special 0",
        "vengeful witch synchro special 1",
        "vengeful witch deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-stone-sweeper-extra-fusion-synchro-lock.test.ts",
      requiredSnippets: [
        "stone sweeper xyz special 0",
        "stone sweeper fusion special 1",
        "stone sweeper synchro special 1",
        "stone sweeper deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-garden-rose-flora-extra-synchro-lock.test.ts",
      requiredSnippets: [
        "garden rose flora fusion special 0",
        "garden rose flora xyz special 0",
        "garden rose flora synchro special 1",
        "garden rose flora deck special 1",
        "targetRange: [1, 0]",
      ],
    },
    {
      file: "test/lua-real-script-mirror-mage-extra-water-synchro-lock.test.ts",
      requiredSnippets: [
        "mirror mage dark synchro special 0",
        "mirror mage water fusion special 0",
        "mirror mage water synchro special 1",
        "mirror mage hand dark special 1",
      ],
    },
    {
      file: "test/lua-real-script-bone-archfiend-extra-dark-dragon-synchro-lock.test.ts",
      requiredSnippets: [
        "bone light dragon synchro special 0",
        "bone dark fiend synchro special 0",
        "bone dark dragon fusion special 0",
        "bone dark dragon synchro special 1",
      ],
    },
    {
      file: "test/lua-real-script-crimson-resonator-extra-dark-dragon-synchro-lock.test.ts",
      requiredSnippets: [
        "crimson light dragon synchro special 0",
        "crimson dark fiend synchro special 0",
        "crimson dark dragon xyz special 0",
        "crimson dark dragon synchro special 1",
      ],
    },
    {
      file: "test/lua-real-script-core-of-chaos-extra-light-dark-synchro-lock.test.ts",
      requiredSnippets: [
        "core earth synchro special 0",
        "core light fusion special 0",
        "core light synchro special 1",
        "core dark synchro special 1",
      ],
    },
    {
      file: "test/lua-real-script-power-vice-extra-dark-synchro-lock.test.ts",
      requiredSnippets: [
        "power vice light synchro special 0",
        "power vice dark fusion special 0",
        "power vice dark synchro special 1",
        "power vice hand light special 1",
      ],
    },
    {
      file: "test/lua-real-script-qq-enneagon-extra-rank9-xyz-lock.test.ts",
      requiredSnippets: [
        "qq rank8 xyz special 0",
        "qq rank10 fusion special 0",
        "qq rank9 xyz special 1",
        "qq rank10 xyz special 1",
      ],
    },
    {
      file: "test/lua-real-script-palm-ryzeal-extra-rank4-xyz-lock.test.ts",
      requiredSnippets: [
        "palm ryzeal rank5 xyz special 0",
        "palm ryzeal fusion special 0",
        "palm ryzeal rank4 xyz special 1",
        "palm ryzeal deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-schwarzschild-extra-dragon-xyz-lock.test.ts",
      requiredSnippets: [
        "schwarzschild machine xyz special 0",
        "schwarzschild dragon synchro special 0",
        "schwarzschild dragon xyz special 1",
        "schwarzschild deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-astral-kuriboh-extra-number-xyz-lock.test.ts",
      requiredSnippets: [
        "astral off-set xyz special 0",
        "astral number fusion special 0",
        "astral number xyz special 1",
        "astral deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-gimmick-puppet-rouge-doll-extra-setcode-lock.test.ts",
      requiredSnippets: [
        "rouge off-set xyz special 0",
        "rouge off-set fusion special 0",
        "rouge gimmick xyz special 1",
        "rouge deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-fallen-white-dragon-extra-level8-fusion-synchro-lock.test.ts",
      requiredSnippets: [
        "fallen white level7 fusion special 0",
        "fallen white level8 xyz special 0",
        "fallen white level8 fusion special 1",
        "fallen white level8 synchro special 1",
      ],
    },
    {
      file: "test/lua-real-script-heraldic-beast-gryphon-extra-xyz-only-lock.test.ts",
      requiredSnippets: [
        "gryphon xyz special 1",
        "gryphon fusion special 0",
        "gryphon hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-fusion-draft-extra-fusion-lock.test.ts",
      requiredSnippets: [
        "fusion draft synchro special 0",
        "fusion draft xyz special 0",
        "fusion draft fusion special 1",
        "fusion draft hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-virtual-world-lulu-level-rank3-summon-lock.test.ts",
      requiredSnippets: [
        "lulu level2 special 0",
        "lulu link2 special 0",
        "lulu level4 special 1",
        "lulu rank3 special 1",
      ],
    },
    {
      file: "test/lua-real-script-odd-eyes-revolution-pendulum-dragon-lock.test.ts",
      requiredSnippets: [
        "revolution dragon pendulum special 1",
        "revolution warrior pendulum special 0",
        "revolution warrior regular special 1",
      ],
    },
    {
      file: "test/lua-real-script-nebula-dragon-light-dark-dragon-lock.test.ts",
      requiredSnippets: [
        "nebula fire dragon special 0",
        "nebula light warrior special 0",
        "nebula light dragon special 1",
        "nebula dark dragon special 1",
      ],
    },
    {
      file: "test/lua-real-script-jokers-straight-extra-light-warrior-lock.test.ts",
      requiredSnippets: [
        "jokers dark warrior special 0",
        "jokers light dragon special 0",
        "jokers light warrior special 1",
        "jokers hand dark warrior special 1",
      ],
    },
    {
      file: "test/lua-real-script-linkbelt-wall-dragon-counter-link-lock.test.ts",
      requiredSnippets: [
        "linkbelt link2 link special 1",
        "linkbelt link3 link special 0",
        "linkbelt link3 fusion special 1",
        "linkbelt fusion link special 1",
      ],
    },
    {
      file: "test/lua-real-script-quadborrel-extra-link2-or-lower-lock.test.ts",
      requiredSnippets: [
        "quadborrel link1 special 0",
        "quadborrel link2 special 0",
        "quadborrel link3 special 1",
        "quadborrel fusion special 1",
      ],
    },
    {
      file: "test/lua-real-script-link-turret-extra-dark-link-lock.test.ts",
      requiredSnippets: [
        "link turret light link special 0",
        "link turret dark synchro special 0",
        "link turret dark link special 1",
        "link turret deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-link-devotee-link3-lock.test.ts",
      requiredSnippets: [
        "link devotee link2 link special 1",
        "link devotee link3 link special 0",
        "link devotee link3 fusion special 1",
        "link devotee fusion link special 1",
      ],
    },
    {
      file: "test/lua-real-script-radiant-typhoon-wind-special-lock.test.ts",
      requiredSnippets: [
        "Duel.IsPlayerCanSpecialSummon",
        "radiant typhoon can special true/false",
        "radiant typhoon dark special 0",
        "radiant typhoon wind special 1",
      ],
    },
    {
      file: "test/lua-real-script-tatsunecro-zombie-special-lock.test.ts",
      requiredSnippets: [
        "Duel.IsPlayerCanSpecialSummon",
        "tatsunecro can special true/false",
        "tatsunecro warrior special 0",
        "tatsunecro zombie special 1",
      ],
    },
    {
      file: "test/lua-real-script-thunder-sea-horse-special-lock.test.ts",
      requiredSnippets: [
        "getLuaRestoreLegalActionGroups(restored, 1)",
        "thunder sea horse responder resolved",
        "specialSummonProcedure",
        "restoredLock.missingRegistryKeys).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-pendulum-area-summon-type-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: `target:special-summon-type-not:${luaSummonTypePendulum}`',
        "targetRange: [1, 1]",
        "pendulum area generic special 0",
        "pendulum area pendulum special 1",
      ],
    },
    {
      file: "test/lua-real-script-fiendish-portrait-deck-extra-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "special-summon-limit:deck-or-extra"',
        "Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK)",
        "Duel.SpecialSummon(extra,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK)",
        "Duel.SpecialSummon(hand,0,0,0,false,false,POS_FACEUP_ATTACK)",
        "fiendish portrait deck special 0",
        "fiendish portrait extra special 0",
        "fiendish portrait hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-edea-extra-deck-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "special-summon-limit:extra"',
        "edea extra special 0",
        "edea hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-isolde-zombie-special-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "target:not-race:16"',
        "isolde fiend special 0",
        "isolde zombie special 1",
      ],
    },
    {
      file: "test/lua-real-script-orcust-cymbal-dark-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "target:not-attribute:32"',
        "orcust dark special 1",
        "orcust light special 0",
      ],
    },
    {
      file: "test/lua-real-script-token-collector-token-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "target:type:16384"',
        "targetRange: [1, 1]",
        "token collector token special 0",
        "token collector hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-crimson-blader-level5-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "target:level-above:5"',
        "targetRange: [1, 0]",
        "crimson blader level5 special 0",
        "crimson blader level4 special 1",
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-wyvern-facedown-summon-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "target:special-summon-position-facedown"',
        "wyvern facedown special 0",
        "wyvern faceup special 1",
      ],
    },
    {
      file: "test/lua-real-script-world-legacy-survivor-extra-link-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "special-summon-limit:not-type-extra:67108864"',
        "world legacy survivor fusion special 0",
        "world legacy survivor synchro special 0",
        "world legacy survivor link special 1",
        "world legacy survivor deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-cation-extra-light-xyz-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "special-summon-limit:not-type-attribute-extra:8388608:16"',
        "cation dark xyz special 0",
        "cation light fusion special 0",
        "cation light xyz special 1",
        "cation deck dark special 1",
      ],
    },
    {
      file: "test/lua-real-script-dogmatikalamity-extra-ritual-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "special-summon-limit:extra"',
        "canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(false)",
        "canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-sunvine-shrine-extra-plant-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "special-summon-limit:not-race-extra:1024"',
        "sunvine warrior extra special 0",
        "sunvine plant extra special 1",
        "sunvine deck special 1",
      ],
    },
    {
      file: "test/lua-real-script-grisaille-prison-synchro-xyz-summon-lock.test.ts",
      requiredSnippets: [
        "target:special-summon-type-is-any",
        "targetRange: [1, 1]",
        "grisaille synchro special 0",
        "grisaille xyz special 0",
        "grisaille fusion special 1",
        "grisaille hand special 1",
      ],
    },
    {
      file: "test/lua-real-script-gagaga-head-xyz-only-summon-lock.test.ts",
      requiredSnippets: [
        "target:special-summon-type-not",
        "luaSummonTypeXyz",
        "gagaga head xyz special 1",
        "gagaga head fusion special 0",
        "gagaga head hand special 0",
      ],
    },
    {
      file: "test/lua-real-script-abyss-actor-twinkle-pendulum-setcode-lock.test.ts",
      requiredSnippets: [
        "target:pendulum-summon-not-setcode",
        "twinkle abyss actor pendulum special 1",
        "twinkle generic pendulum special 0",
        "twinkle regular special 1",
      ],
    },
    {
      file: "test/lua-real-script-ashened-extra-pyro-lock.test.ts",
      requiredSnippets: [
        "ashened extra machine special 0",
        "ashened hand machine special 1",
        "ashened extra pyro special 1",
      ],
    },
    {
      file: "test/lua-real-script-augmented-heraldry-psychic-xyz-heraldic-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: "target:not-race-type-or-setcode:1048576:8388608:118"',
        "augmented heraldry outsider special 0",
        "augmented heraldry psychic xyz special 1",
        "augmented heraldry heraldic special 1",
      ],
    },
    {
      file: "test/lua-real-script-odd-eyes-phantasma-pendulum-summon-lock.test.ts",
      requiredSnippets: [
        "target:special-summon-type-is",
        "luaSummonTypePendulum",
        "targetRange: [1, 0]",
        "phantasma pendulum special 0",
        "phantasma regular special 1",
      ],
    },
    {
      file: "test/lua-real-script-vanitys-fiend-special-summon-lock.test.ts",
      requiredSnippets: [
        "code: 22",
        "targetRange: [1, 1]",
        "Duel.IsPlayerCanSpecialSummon",
        "vanity can special false/false",
        "vanity special result 0/0",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}

function representativeSameCodeExtraDeckOnceLockFixtures(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-accel-synchron-synchro-once-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: `target:summon-type-code:${luaSummonTypeSynchro}:${accelCode}`',
        "accel synchro special 0",
        "accel fusion special 1",
        "other synchro special 1",
        "fusion synchro special 1",
      ],
    },
    {
      file: "test/lua-real-script-prank-kids-meow-link-once-lock.test.ts",
      requiredSnippets: [
        'luaTargetDescriptor: `target:link-summon-code:${meowCode}`',
        "meow link special 0",
        "meow fusion special 1",
        "other link special 1",
        "fusion link special 1",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
