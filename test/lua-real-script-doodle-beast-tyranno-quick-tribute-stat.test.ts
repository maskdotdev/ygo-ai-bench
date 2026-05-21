import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tyrannoCode = "67725394";
const tributeCode = "677253940";
const destroyTargetCode = "677253941";
const responderCode = "677253942";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTyrannoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tyrannoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDinosaur = 0x10000;
const attributeEarth = 0x1;
const setDoodleBeast = 0x1186;

describe.skipIf(!hasUpstreamScripts || !hasTyrannoScript)("Lua real script Doodle Beast Tyranno quick Tribute Summon stat", () => {
  it("restores quick hand Tribute SummonOrSet into material-labeled destroy and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tyrannoCode}.lua`);
    expect(script).toContain("aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,aux.Stringid(id,0),s.otfilter)");
    expect(script).toContain("aux.AddNormalSetProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,aux.Stringid(id,0),s.otfilter)");
    expect(script).toContain("e1:SetCategory(CATEGORY_SUMMON+CATEGORY_SET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("return Duel.IsMainPhase() and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_DINOSAUR),tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
    expect(script).toContain("if chk==0 then return c:CanSummonOrSet(true,nil,1) end");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SUMMON,c,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SummonOrSet(tp,c,true,nil,1)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("if g:IsExists(Card.IsSetCard,1,nil,SET_DOODLE_BEAST) then");
    expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local atk=0");
    expect(script).toContain("if tc:IsFaceup() then atk=tc:GetAttack()/2 end");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(atk)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 67725394, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tyrannoCode, destroyTargetCode, tributeCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const tyranno = requireCard(session, tyrannoCode);
    const tribute = requireCard(session, tributeCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    const responder = requireCard(session, responderCode, 1);
    moveDuelCard(session.state, tyranno.uid, "hand", 0);
    moveFaceUpAttack(session, destroyTarget, 0);
    moveFaceUpAttack(session, tribute, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    session.state.players[0].normalSummonAvailable = false;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tyrannoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const quickSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === tyranno.uid);
    expect(quickSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, quickSummon!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: tyranno.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x100, targetUids: [tyranno.uid], count: 1, player: 0, parameter: 0x2 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("doodle responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === tyranno.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "tribute",
      summonMaterialUids: [tribute.uid],
      sequence: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.summon,
      reasonCardUid: tyranno.uid,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "normalSummoning", "normalSummoned"].includes(event.eventName))).toEqual([
      sentToGraveyardEvent(tribute.uid, tyranno.uid),
      normalSummoningEvent(tyranno.uid),
      normalSummonedEvent(tyranno.uid),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const destroyTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === tyranno.uid);
    expect(destroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, destroyTrigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-4-1100",
        sourceUid: tyranno.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 1,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: tyranno.uid,
        eventPlayer: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        operationInfos: [{ category: 0x1, targetUids: [destroyTarget.uid, tyranno.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    resolveRestoredChain(restoredTriggerWindow);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: tyranno.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredTriggerWindow.session.state.cards.find((card) => card.uid === tyranno.uid), restoredTriggerWindow.session.state)).toBe(4300);
    expect(restoredTriggerWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      destroyedEvent(destroyTarget.uid, tyranno.uid),
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: tyrannoCode, name: "Doodle Beast - Tyranno", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 8, attack: 2400, defense: 1200, setcodes: [setDoodleBeast] },
    { code: tributeCode, name: "Doodle Beast Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, setcodes: [setDoodleBeast] },
    { code: destroyTargetCode, name: "Doodle Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 3800, defense: 1000 },
    { code: responderCode, name: "Doodle Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("doodle responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function sentToGraveyardEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.release | duelReason.summon,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function normalSummoningEvent(cardUid: string) {
  return {
    eventName: "normalSummoning",
    eventCode: 1103,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function normalSummonedEvent(cardUid: string) {
  return {
    eventName: "normalSummoned",
    eventCode: 1100,
    eventCardUid: cardUid,
    eventReason: duelReason.summon,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
  };
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
