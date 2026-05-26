import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gokaCode = "23116808";
const fireCostCode = "231168080";
const fireDestroyCode = "231168081";
const darkDecoyCode = "231168082";
const responderCode = "231168083";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGokaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gokaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePyro = 0x80;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasGokaScript)("Lua real script Goka procedure destroy release stat", () => {
  it("restores FIRE-gated inherent Special Summon, mandatory destroy trigger, and release-cost ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gokaCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_UNCOPYABLE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_FIRE),tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCondition(function(e) return e:GetHandler():IsSummonType(SUMMON_TYPE_SPECIAL+1) end)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_FIRE),tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("Duel.IsTurnPlayer(tp)");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,TOKEN_FIREBALL,0,TYPES_TOKEN,100,100,1,RACE_PYRO,ATTRIBUTE_FIRE,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsAttribute,1,false,nil,c,ATTRIBUTE_FIRE)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsAttribute,1,1,false,nil,c,ATTRIBUTE_FIRE)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(500)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };

    const blocked = createRestoredProcedureWindow({ reader, source, workspace, withFireMonster: false });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restoredProcedure = createRestoredProcedureWindow({ reader, source, workspace, withFireMonster: true });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const goka = requireCard(restoredProcedure.session, gokaCode);
    const fireDestroy = requireCard(restoredProcedure.session, fireDestroyCode);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === goka.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === goka.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      summonTypeCode: 0x40000001,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-1102",
        sourceUid: goka.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: goka.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventTriggerTiming: "when",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === goka.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-4",
        chainIndex: 1,
        effectId: "lua-2-1102",
        sourceUid: goka.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 1,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: goka.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventTriggerTiming: "when",
        targetFieldIds: [6],
        targetUids: [fireDestroy.uid],
        operationInfos: [{ category: 0x1, targetUids: [fireDestroy.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === requireCard(restoredChain.session, responderCode).uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("goka responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === fireDestroy.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: goka.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "destroyed"].includes(event.eventName))).toEqual([
      specialSummonedEvent(goka.uid),
      becameTargetEvent(fireDestroy.uid, goka.uid),
      destroyedEvent(fireDestroy.uid, goka.uid),
    ]);

    const restoredAtk = createRestoredAtkWindow({ reader, source, workspace });
    expectCleanRestore(restoredAtk);
    expectRestoredLegalActions(restoredAtk, 0);
    const atkGoka = requireCard(restoredAtk.session, gokaCode);
    const fireCost = requireCard(restoredAtk.session, fireCostCode);
    expect(currentAttack(atkGoka, restoredAtk.session.state)).toBe(2200);
    const boost = getLuaRestoreLegalActions(restoredAtk, 0).find((action) => action.type === "activateEffect" && action.uid === atkGoka.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredAtk, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAtk, boost!);
    expect(restoredAtk.session.state.cards.find((card) => card.uid === fireCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: atkGoka.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredAtk.session.state.cards.find((card) => card.uid === atkGoka.uid)!, restoredAtk.session.state)).toBe(2700);
    expect(restoredAtk.session.state.eventHistory.filter((event) => ["released"].includes(event.eventName))).toEqual([
      releasedEvent(fireCost.uid, atkGoka.uid),
    ]);
  });
});

function createRestoredProcedureWindow({
  reader,
  source,
  workspace,
  withFireMonster,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  withFireMonster: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: withFireMonster ? 23116808 : 23116807, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gokaCode, fireDestroyCode, darkDecoyCode] }, 1: { main: [responderCode] } });
  startDuel(session);

  moveDuelCard(session.state, requireCard(session, gokaCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, withFireMonster ? fireDestroyCode : darkDecoyCode), 0);
  moveDuelCard(session.state, requireCard(session, responderCode).uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gokaCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredAtkWindow({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 23116809, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gokaCode, fireCostCode] }, 1: { main: [] } });
  startDuel(session);

  moveFaceUpAttack(session, requireCard(session, gokaCode), 0);
  moveFaceUpAttack(session, requireCard(session, fireCostCode), 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gokaCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    { code: gokaCode, name: "Goka, the Pyre of Malice", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 6, attack: 2200, defense: 1900 },
    { code: fireCostCode, name: "Goka Fire Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: fireDestroyCode, name: "Goka Fire Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
    { code: darkDecoyCode, name: "Goka Dark Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: responderCode, name: "Goka Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("goka responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function specialSummonedEvent(cardUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
  };
}

function becameTargetEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
        eventValue: 1,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 2,
    eventChainDepth: 1,
    eventChainLinkId: "chain-4",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
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
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function releasedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: cardUid,
    eventReason: duelReason.cost | duelReason.release,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}
