import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const soulUnionCode = "69389481";
const hasSoulUnionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${soulUnionCode}.lua`));
const attackerCode = "693894810";
const heroCode = "693894811";
const defenderCode = "693894812";
const responderCode = "693894813";
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setElementalHero = 0x3008;

describe.skipIf(!hasUpstreamScripts || !hasSoulUnionScript)("Lua real script Soul Union Damage Step HERO stat", () => {
  it("restores Damage Step target pair selection into Elemental HERO grave ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${soulUnionCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_REMOVE+CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil):GetFirst()");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_REMOVE,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_FUSION_SUMMON,nil,1,tp,LOCATION_EXTRA)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(gc:GetAttack())");
    expect(script).toContain("Fusion.SummonEffOP(params)(e,tp,eg,ep,ev,re,r,rp)");

    const cards: DuelCardData[] = [
      { code: soulUnionCode, name: "Soul Union", kind: "trap", typeFlags: typeTrap },
      { code: attackerCode, name: "Soul Union Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: heroCode, name: "Soul Union Elemental HERO", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setElementalHero], level: 4, attack: 1800, defense: 1200 },
      { code: defenderCode, name: "Soul Union Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 1000 },
      { code: responderCode, name: "Soul Union Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 69389481, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soulUnionCode, attackerCode, heroCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const soulUnion = requireCard(session, soulUnionCode);
    const attacker = requireCard(session, attackerCode);
    const hero = requireCard(session, heroCode);
    const defender = requireCard(session, defenderCode);
    const responder = requireCard(session, responderCode);
    const setSoulUnion = moveDuelCard(session.state, soulUnion.uid, "spellTrapZone", 0);
    setSoulUnion.faceUp = false;
    setSoulUnion.position = "faceDown";
    moveFaceUpAttack(session, attacker.uid, 0);
    moveDuelCard(session.state, hero.uid, "graveyard", 0);
    moveFaceUpAttack(session, defender.uid, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [soulUnionCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 1, "passAttack");
    passBattleAction(session, 0, "passAttack");
    passBattleAction(session, 1, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });
    expect(currentAttack(attacker, session.state)).toBe(1500);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === soulUnion.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: soulUnion.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [7, 8],
        targetUids: [attacker.uid, hero.uid],
        effectLabelObjectUid: attacker.uid,
        possibleOperationInfos: [
          { category: 4, count: 1, parameter: 16, player: 0, targetUids: [] },
          { category: 512, count: 1, parameter: 64, player: 0, targetUids: [] },
          { category: 1073741824, count: 1, parameter: 64, player: 0, targetUids: [] },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("soul union responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === soulUnion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === attacker.uid), restoredChain.session.state)).toBe(3300);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === defender.uid), restoredChain.session.state)).toBe(3000);
    expect(restoredChain.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 100 && effect.sourceUid === attacker.uid).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, property: 0x400, reset: { flags: 1107169792 }, value: 1800 }]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid), restoredBoost.session.state)).toBe(3300);
    passRestoredBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: duelReason.battle,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 0,
        eventValue: 300,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("soul union responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function passBattleAction(session: DuelSession, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const action = getLegalActions(session, player).find((candidate) => candidate.type === type);
  expect(action, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, action!);
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    if (restored.session.state.chain.length > 0) {
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restored, pass!);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
