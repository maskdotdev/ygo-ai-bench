import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  startDuel,
} from "#duel/core.js";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("EDOPro compatibility harness scaffolding", () => {
  it("lets Lua effects register, read, and reset duel and card flags", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Flag Source", kind: "monster" }];
    const session = createDuel({ seed: 22, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Debug.Message("duel flag register " .. Duel.RegisterFlagEffect(0, 901, RESET_EVENT, 0, 3))
          Debug.Message("card flag register " .. c:RegisterFlagEffect(902, RESET_EVENT, 0, 4))
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag count " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag count " .. c:GetFlagEffect(902))
          Debug.Message("duel flag reset " .. Duel.ResetFlagEffect(0, 901))
          Debug.Message("card flag reset " .. c:ResetFlagEffect(902))
          Debug.Message("duel flag after " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag after " .. c:GetFlagEffect(902))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-effects.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("duel flag register 1");
    expect(host.messages).toContain("card flag register 1");
    expect(host.messages).toContain("duel flag count 1");
    expect(host.messages).toContain("card flag count 1");
    expect(host.messages).toContain("duel flag reset 1");
    expect(host.messages).toContain("card flag reset 1");
    expect(host.messages).toContain("duel flag after 0");
    expect(host.messages).toContain("card flag after 0");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("provides common aux compatibility helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Aux A", kind: "monster" },
      { code: "200", name: "Aux B", kind: "monster" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_stringid = aux.Stringid(100, 2)
      Debug.Message("true count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      Debug.Message("false count " .. Duel.GetMatchingGroupCount(aux.FALSE, 0, LOCATION_HAND, 0, nil))
      local wrapped = aux.NecroValleyFilter(aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("wrapped count " .. Duel.GetMatchingGroupCount(wrapped, 0, LOCATION_HAND, 0, nil))
      Debug.Message("target exists " .. tostring(Duel.IsExistingTarget(aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, nil)))
      Debug.Message("target count " .. Duel.GetTargetCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      `,
      "aux-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_stringid")).toBe(1602);
    expect(host.messages).toContain("true count 2");
    expect(host.messages).toContain("false count 0");
    expect(host.messages).toContain("wrapped count 1");
    expect(host.messages).toContain("target exists true");
    expect(host.messages).toContain("target count 2");
  });

  it("provides deterministic Lua option prompt helpers", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Prompt Source", kind: "monster" }];
    const session = createDuel({ seed: 30, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local option=Duel.SelectOption(0, 101, 102, 103)
      local yes=Duel.SelectYesNo(0, 201)
      local number=Duel.AnnounceNumber(0, 4, 7, 9)
      local card=Duel.AnnounceCard(0, 100, 200)
      local kind=Duel.AnnounceType(0, TYPE_MONSTER, TYPE_SPELL)
      local race=Duel.AnnounceRace(0, RACE_WARRIOR, RACE_SPELLCASTER)
      local attribute=Duel.AnnounceAttribute(0, ATTRIBUTE_LIGHT, ATTRIBUTE_DARK)
      local disabled=Duel.SelectDisableField(0, 1, LOCATION_MZONE, 0, 0)
      local selected=Duel.SelectField(0, 2, LOCATION_SZONE, LOCATION_MZONE, 0)
      Debug.Message("prompt option " .. option .. "/" .. tostring(yes))
      Debug.Message("prompt announce " .. number .. "/" .. card .. "/" .. kind .. "/" .. race .. "/" .. attribute)
      Debug.Message("prompt zones " .. disabled .. "/" .. selected .. "/" .. ZONES_MMZ .. "/" .. ZONES_EMZ)
      `,
      "prompt-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("prompt option 0/true");
    expect(host.messages).toContain("prompt announce 4/100/1/1/16");
    expect(host.messages).toContain("prompt zones 1/768/31/96");
  });

  it("exposes summon type metadata to Lua card helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon A", kind: "monster" },
      { code: "300", name: "Summon B", kind: "monster" },
      { code: "900", name: "Summon Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 19, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normalUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === normalUid);
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);

    const host = createLuaScriptHost(session);
    const normalResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("normal type " .. tostring(c:IsSummonType(SUMMON_TYPE_NORMAL)) .. "/" .. c:GetSummonType())
      Debug.Message("normal activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      `,
      "summon-type-normal.lua",
    );

    expect(normalResult.ok).toBe(true);
    expect(host.messages).toContain("normal type true/268435456");
    expect(host.messages).toContain("normal activity 1/1/0");

    const fusion = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon");
    expect(fusion).toBeDefined();
    expect(applyResponse(session, fusion!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.code === "900")?.summonType).toBe("fusion");

    const fusionResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion type " .. tostring(c:IsSummonType(SUMMON_TYPE_FUSION)) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_SPECIAL)))
      Debug.Message("fusion activity " .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON))
      cost_reason = REASON_COST
      `,
      "summon-type-fusion.lua",
    );

    expect(fusionResult.ok).toBe(true);
    expect(host.messages).toContain("fusion type true/true");
    expect(host.messages).toContain("fusion activity 2/1/1");
    expect(host.getGlobalNumber("cost_reason")).toBe(0x80);
  });

  it("exposes card owner, controller, location, sequence, and position metadata", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "State Probe", kind: "monster", typeFlags: 0x21, attack: 1700, defense: 1300, level: 4, race: 0x2, attribute: 0x20 }];
    const session = createDuel({ seed: 20, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon");
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("card state " .. c:GetOwner() .. "/" .. tostring(c:IsOwner(0)) .. "/" .. c:GetControler() .. "/" .. c:GetLocation() .. "/" .. c:GetSequence() .. "/" .. c:GetPosition())
      Debug.Message("original meta " .. c:GetOriginalCode() .. "/" .. c:GetOriginalType() .. "/" .. c:GetOriginalLevel() .. "/" .. c:GetOriginalRace() .. "/" .. c:GetOriginalAttribute())
      Debug.Message("base stats " .. c:GetBaseAttack() .. "/" .. c:GetBaseDefense())
      Debug.Message("position checks " .. tostring(c:IsPosition(POS_FACEUP_ATTACK)) .. "/" .. tostring(c:IsControler(0)))
      Debug.Message("relation checks " .. tostring(c:IsOnField()) .. "/" .. tostring(c:IsMonster()) .. "/" .. tostring(c:IsSpell()) .. "/" .. tostring(c:IsTrap()) .. "/" .. tostring(c:IsCanBeEffectTarget(nil)))
      Debug.Message("activity counts " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_FLIPSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_ATTACK))
      Debug.Message("used summon legality " .. tostring(Duel.IsPlayerCanSummon(0, c)) .. "/" .. tostring(Duel.IsPlayerCanMSet(0, c)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, c)))
      Duel.SendtoGrave(c, REASON_EFFECT)
      local g = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      Debug.Message("previous state " .. g:GetPreviousLocation() .. "/" .. g:GetPreviousControler() .. "/" .. g:GetPreviousSequence() .. "/" .. g:GetPreviousPosition())
      Debug.Message("previous position " .. tostring(g:IsPreviousPosition(POS_FACEUP_ATTACK)))
      Debug.Message("grave relation " .. tostring(g:IsOnField()) .. "/" .. tostring(g:IsMonster()))
      `,
      "card-state.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("card state 0/true/0/4/0/1");
    expect(host.messages).toContain("original meta 100/33/4/2/32");
    expect(host.messages).toContain("base stats 1700/1300");
    expect(host.messages).toContain("position checks true/true");
    expect(host.messages).toContain("relation checks true/true/false/false/true");
    expect(host.messages).toContain("activity counts 1/1/0/0/0");
    expect(host.messages).toContain("used summon legality false/false/false");
    expect(host.messages).toContain("previous state 4/0/0/1");
    expect(host.messages).toContain("previous position true");
    expect(host.messages).toContain("grave relation false/true");
  });

  it("executes smoke-test Lua scripts with EDOPro-style globals", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_player = Duel.GetTurnPlayer()
      observed_turn = Duel.GetTurnCount()
      observed_phase = Duel.GetCurrentPhase()
      observed_turn_player = tostring(Duel.IsTurnPlayer(0))
      observed_not_turn_player = tostring(Duel.IsTurnPlayer(1))
      observed_main_phase = tostring(Duel.IsMainPhase())
      observed_battle_phase = tostring(Duel.IsBattlePhase())
      observed_damage_step = tostring(Duel.IsDamageStep())
      observed_damage_calculated = tostring(Duel.IsDamageCalculated())
      observed_normal_activity = Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON)
      observed_summon_activity = Duel.GetActivityCount(0, ACTIVITY_SUMMON)
      observed_attack_activity = Duel.GetActivityCount(0, ACTIVITY_ATTACK)
      local hand = Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      observed_can_summon = tostring(Duel.IsPlayerCanSummon(0, hand))
      observed_can_mset = tostring(Duel.IsPlayerCanMSet(0, hand))
      observed_can_special = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0, hand))
      observed_bad_special_position = tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEDOWN_ATTACK, 0, hand))
      Debug.Message("lua host online")
      `,
      "smoke.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_player")).toBe(0);
    expect(host.getGlobalNumber("observed_turn")).toBe(1);
    expect(host.getGlobalNumber("observed_phase")).toBe(0x4);
    expect(host.getGlobalString("observed_turn_player")).toBe("true");
    expect(host.getGlobalString("observed_not_turn_player")).toBe("false");
    expect(host.getGlobalString("observed_main_phase")).toBe("true");
    expect(host.getGlobalString("observed_battle_phase")).toBe("false");
    expect(host.getGlobalString("observed_damage_step")).toBe("false");
    expect(host.getGlobalString("observed_damage_calculated")).toBe("false");
    expect(host.getGlobalNumber("observed_normal_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_summon_activity")).toBe(0);
    expect(host.getGlobalNumber("observed_attack_activity")).toBe(0);
    expect(host.getGlobalString("observed_can_summon")).toBe("true");
    expect(host.getGlobalString("observed_can_mset")).toBe("true");
    expect(host.getGlobalString("observed_can_special")).toBe("true");
    expect(host.getGlobalString("observed_bad_special_position")).toBe("false");
    expect(host.messages).toContain("lua host online");
  });
});
