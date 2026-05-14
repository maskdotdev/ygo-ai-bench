import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, loadDecks, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe("Lua destroy substitute effects", () => {
  it("destroys an equip substitute handler before ordinary destroy replacement", () => {
    const { equip, host, session, target } = setupSyntheticEquipSubstitute();

    destroyDuelCard(session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 1);

    expect(host.messages).toContain("substitute value 65/1/true");
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
      reasonPlayer: 0,
    });
    expect(session.state.log).toContainEqual(expect.objectContaining({ action: "destroySubstitute", card: target.name }));
    expect(session.state.log).not.toContainEqual(expect.objectContaining({ detail: "Lua effect resolved without an operation" }));
    expect(host.messages).not.toContain("ordinary replace op 400");
  });

  it("destroys every valid equip substitute handler for the same threatened card", () => {
    const { equipA, equipB, host, session, target } = setupSyntheticMultipleEquipSubstitutes();

    destroyDuelCard(session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 1);

    expect(host.messages).toContain("first substitute value 65/1/true");
    expect(host.messages).toContain("second substitute value 65/1/true");
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === equipA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
    });
    expect(session.state.cards.find((card) => card.uid === equipB.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
    });
  });

  it("falls through a false destroy substitute value to normal destruction", () => {
    const { equip, host, session, target } = setupSyntheticEquipSubstitute();

    destroyDuelCard(session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 0);

    expect(host.messages).toContain("substitute value 65/0/true");
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target.uid,
      reason: duelReason.lostTarget,
    });
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script destroy substitute effects", () => {
  it("applies Project Ignis Union procedure destroy substitute effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const unionCode = "99249638";
    const targetCode = "601003";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === unionCode),
      { code: targetCode, name: "Union Procedure Substitute Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
    ];
    const session = createDuel({ seed: 295, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: [unionCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const union = findHandCard(session, 0, unionCode);
    const target = findHandCard(session, 0, targetCode);
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    moveDuelCard(session.state, union.uid, "spellTrapZone", 0);
    union.equippedToUid = target.uid;
    union.position = "faceUpAttack";
    union.faceUp = true;
    const stateResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${unionCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      aux.SetUnionState(c)
      Debug.Message("union procedure status " .. tostring(c:IsHasEffect(EFFECT_UNION_STATUS)~=nil))
      `,
      "union-procedure-state.lua",
    );
    expect(stateResult.ok, stateResult.error).toBe(true);
    expect(host.messages).toContain("union procedure status true");

    destroyDuelCard(session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 1);

    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === union.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
    });
  });

  it("honors old Project Ignis Union battle-only destroy substitute rules", () => {
    const effectCase = setupRealOldUnionSubstitute();

    destroyDuelCard(effectCase.session.state, effectCase.target.uid, 0, duelReason.effect | duelReason.destroy, 1);

    expect(effectCase.session.state.cards.find((card) => card.uid === effectCase.target.uid)).toMatchObject({ location: "graveyard" });
    expect(effectCase.session.state.cards.find((card) => card.uid === effectCase.union.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: effectCase.target.uid,
      reason: duelReason.lostTarget,
    });

    const battleCase = setupRealOldUnionSubstitute();

    destroyDuelCard(battleCase.session.state, battleCase.target.uid, 0, duelReason.battle | duelReason.destroy, 1);

    expect(battleCase.session.state.cards.find((card) => card.uid === battleCase.target.uid)).toMatchObject({ location: "monsterZone" });
    expect(battleCase.session.state.cards.find((card) => card.uid === battleCase.union.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
    });
  });

  it("applies Legendary Ebon Steed's Project Ignis equip destroy substitute", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const steedCode = "12324546";
    const targetCode = "601001";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === steedCode),
      { code: targetCode, name: "Six Samurai Substitute Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200, setcodes: [0x3d] },
    ];
    const session = createDuel({ seed: 289, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: [steedCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const steed = findHandCard(session, 0, steedCode);
    const target = findHandCard(session, 0, targetCode);
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(steedCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    moveDuelCard(session.state, steed.uid, "spellTrapZone", 0);
    steed.equippedToUid = target.uid;
    steed.position = "faceUpAttack";
    steed.faceUp = true;

    destroyDuelCard(session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 1);

    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === steed.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
    });
  });
});

function setupSyntheticEquipSubstitute(): {
  equip: DuelCardInstance;
  host: ReturnType<typeof createLuaScriptHost>;
  session: DuelSession;
  target: DuelCardInstance;
} {
  const cards: DuelCardData[] = [
    { code: "100", name: "Callback Substitute Equip", kind: "monster" },
    { code: "200", name: "Equipped Substitute Target", kind: "monster" },
    { code: "300", name: "Ordinary Replacement Source", kind: "monster" },
    { code: "400", name: "Ordinary Replacement Cost", kind: "monster" },
  ];
  const session = createDuel({ seed: 288, startingHandSize: 4, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "200", "300", "400"] }, 1: { main: [] } });
  startDuel(session);

  const equip = findHandCard(session, 0, "100");
  const target = findHandCard(session, 0, "200");
  moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";

  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    c100={}
    function c100.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_EQUIP)
      e:SetCode(EFFECT_DESTROY_SUBSTITUTE)
      e:SetValue(function(e,re,r,rp)
        Debug.Message("substitute value " .. r .. "/" .. rp .. "/" .. tostring(re==nil))
        return (r&REASON_EFFECT)~=0 and rp==1
      end)
      c:RegisterEffect(e)
    end
    c300={}
    function c300.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e:SetCode(EFFECT_DESTROY_REPLACE)
      e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e:SetRange(LOCATION_HAND)
      e:SetTargetRange(1,0)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return rp==1 and Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 400), tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
        local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 400), tp, LOCATION_HAND, 0, e:GetHandler())
        Duel.SetTargetCard(g)
        Debug.Message("ordinary replace target " .. Duel.GetTargetCards():GetCount())
        return true
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        local g=Duel.GetTargetCards()
        Debug.Message("ordinary replace op " .. g:GetFirst():GetCode())
        Duel.SendtoGrave(g, REASON_EFFECT+REASON_REPLACE)
      end)
      c:RegisterEffect(e)
    end
    `,
    "destroy-substitute-equip-callback.lua",
  );

  expect(result.ok, result.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  moveDuelCard(session.state, equip.uid, "spellTrapZone", 0);
  equip.equippedToUid = target.uid;
  equip.position = "faceUpAttack";
  equip.faceUp = true;
  return { equip, host, session, target };
}

function setupSyntheticMultipleEquipSubstitutes(): {
  equipA: DuelCardInstance;
  equipB: DuelCardInstance;
  host: ReturnType<typeof createLuaScriptHost>;
  session: DuelSession;
  target: DuelCardInstance;
} {
  const cards: DuelCardData[] = [
    { code: "101", name: "First Substitute Equip", kind: "monster" },
    { code: "102", name: "Second Substitute Equip", kind: "monster" },
    { code: "200", name: "Multi-Substitute Target", kind: "monster" },
  ];
  const session = createDuel({ seed: 294, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["101", "102", "200"] }, 1: { main: [] } });
  startDuel(session);

  const equipA = findHandCard(session, 0, "101");
  const equipB = findHandCard(session, 0, "102");
  const target = findHandCard(session, 0, "200");
  moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";

  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    c101={}
    function c101.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_EQUIP)
      e:SetCode(EFFECT_DESTROY_SUBSTITUTE)
      e:SetValue(function(e,re,r,rp)
        Debug.Message("first substitute value " .. r .. "/" .. rp .. "/" .. tostring(re==nil))
        return (r&REASON_EFFECT)~=0 and rp==1
      end)
      c:RegisterEffect(e)
    end
    c102={}
    function c102.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_EQUIP)
      e:SetCode(EFFECT_DESTROY_SUBSTITUTE)
      e:SetValue(function(e,re,r,rp)
        Debug.Message("second substitute value " .. r .. "/" .. rp .. "/" .. tostring(re==nil))
        return (r&REASON_EFFECT)~=0 and rp==1
      end)
      c:RegisterEffect(e)
    end
    `,
    "multiple-destroy-substitutes.lua",
  );

  expect(result.ok, result.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  for (const equip of [equipA, equipB]) {
    moveDuelCard(session.state, equip.uid, "spellTrapZone", 0);
    equip.equippedToUid = target.uid;
    equip.position = "faceUpAttack";
    equip.faceUp = true;
  }
  return { equipA, equipB, host, session, target };
}

function setupRealOldUnionSubstitute(): { session: DuelSession; target: DuelCardInstance; union: DuelCardInstance } {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const unionCode = "11678191";
  const targetCode = "84173492";
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === unionCode),
    { code: targetCode, name: "Old Union Substitute Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
  ];
  const session = createDuel({ seed: 296, startingHandSize: 2, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: [unionCode, targetCode] }, 1: { main: [] } });
  startDuel(session);

  const union = findHandCard(session, 0, unionCode);
  const target = findHandCard(session, 0, targetCode);
  moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(unionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  moveDuelCard(session.state, union.uid, "spellTrapZone", 0);
  union.equippedToUid = target.uid;
  union.position = "faceUpAttack";
  union.faceUp = true;
  const stateResult = host.loadScript(
    `
    local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${unionCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
    aux.SetUnionState(c)
    `,
    "old-union-procedure-state.lua",
  );
  expect(stateResult.ok, stateResult.error).toBe(true);
  return { session, target, union };
}

function findHandCard(session: DuelSession, controller: 0 | 1, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.controller === controller && candidate.location === "hand" && candidate.code === code);
  expect(card).toBeTruthy();
  return card!;
}
