import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const staurikoCode = "48411996";
const hasStaurikoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${staurikoCode}.lua`));
const tokenCode = "48411997";
const attackerCode = "48411998";
const responderCode = "48411999";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typesToken = 0x4011;
const raceDinosaur = 0x800;
const attributeFire = 0x4;
const setJurrac = 0x22;

describe.skipIf(!hasUpstreamScripts || !hasStaurikoScript)("Lua real script Jurrac Stauriko battle destroyed token step", () => {
  it("restores mandatory battle-destroyed staged Jurrac Token summons and unreleasable lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${staurikoCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,2,tp,0)");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,SET_JURRAC,TYPES_TOKEN,0,0,1,RACE_DINOSAUR,ATTRIBUTE_FIRE)");
    expect(script).toContain("local token=Duel.CreateToken(tp,id+1)");
    expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e1:SetCode(EFFECT_UNRELEASABLE_SUM)");
    expect(script).toContain("e1:SetValue(aux.TargetBoolFunction(aux.NOT(Card.IsSetCard),SET_JURRAC))");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    const operationInfos = [
      { category: 0x400, targetUids: [], count: 2, player: 0, parameter: 0 },
      { category: 0x200, targetUids: [], count: 2, player: 0, parameter: 0 },
    ];
    expect(operationInfos.map((info) => info.category)).toEqual([0x400, 0x200]);

    const cards: DuelCardData[] = [
      { code: staurikoCode, name: "Jurrac Stauriko", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeFire, level: 2, attack: 500, defense: 400, setcodes: [setJurrac] },
      { code: tokenCode, name: "Jurrac Token", kind: "monster", typeFlags: typesToken, race: raceDinosaur, attribute: attributeFire, level: 1, attack: 0, defense: 0, setcodes: [setJurrac] },
      { code: attackerCode, name: "Jurrac Stauriko Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Jurrac Stauriko Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 48411996, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [staurikoCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const stauriko = requireCard(session, staurikoCode);
    const attacker = requireCard(session, attackerCode);
    const responder = requireCard(session, responderCode);
    const movedStauriko = moveDuelCard(session.state, stauriko.uid, "monsterZone", 0);
    movedStauriko.position = "faceUpAttack";
    movedStauriko.faceUp = true;
    const movedAttacker = moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    movedAttacker.position = "faceUpAttack";
    movedAttacker.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(staurikoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 1);
    expect(restoredInitial.session.state.effects.find((effect) => effect.sourceUid === stauriko.uid)).toMatchObject({
      category: 0x600,
      code: 1140,
      event: "trigger",
      triggerEvent: "battleDestroyed",
      triggerSourceOnly: true,
    });
    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === stauriko.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredInitial, attack!);
    passBattleResponses(restoredInitial.session);
    expect(restoredInitial.session.state.cards.find((card) => card.uid === stauriko.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker.uid,
    });
    expect(restoredInitial.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-6-1",
        effectId: "lua-1-1140",
        sourceUid: stauriko.uid,
        triggerBucket: "opponentMandatory",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventPlayer: 0,
        eventCardUid: stauriko.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === stauriko.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === 43).map((effect) => effect.luaValueDescriptor)).toEqual([
      `cannot-material:target-not-setcode:${setJurrac}`,
      `cannot-material:target-not-setcode:${setJurrac}`,
    ]);
    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 1);
    expect(restoredResolved.host.messages).not.toContain("jurrac responder resolved");
    const tokens = restoredResolved.session.state.cards.filter((card) => card.code === tokenCode);
    expect(tokens).toHaveLength(2);
    expect(tokens.map((token) => ({
      location: token.location,
      controller: token.controller,
      owner: token.owner,
      faceUp: token.faceUp,
      position: token.position,
      typeFlags: token.data.typeFlags,
      race: token.data.race,
      attribute: token.data.attribute,
      reason: token.reason,
      reasonCardUid: token.reasonCardUid,
      reasonEffectId: token.reasonEffectId,
    }))).toEqual([
      { location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", typeFlags: typesToken, race: raceDinosaur, attribute: attributeFire, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: stauriko.uid, reasonEffectId: 1 },
      { location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", typeFlags: typesToken, race: raceDinosaur, attribute: attributeFire, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: stauriko.uid, reasonEffectId: 1 },
    ]);
    expect(restoredResolved.session.state.effects.filter((effect) => tokens.some((token) => token.uid === effect.sourceUid) && effect.code === 43)).toHaveLength(2);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["battleDestroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: stauriko.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: tokens[0]!.uid,
        eventUids: tokens.map((token) => token.uid),
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: stauriko.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("jurrac responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
