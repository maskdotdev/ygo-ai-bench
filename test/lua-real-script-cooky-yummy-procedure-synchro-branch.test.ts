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
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cookyCode = "68810435";
const link1Code = "688104350";
const synchroSummonerCode = "688104351";
const opponentTargetCode = "688104352";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeLink = 0x4000000;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cooky Yummy procedure Synchro branch", () => {
  it("restores Link-1 hand procedure and Synchro-effect summon trigger into SelectEffect destroy branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cookyData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === cookyCode);
    expect(cookyData).toBeDefined();
    const script = workspace.readScript(`c${cookyCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.spconfilter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("return (c:IsLink(1) or (c:IsType(TYPE_SYNCHRO) and c:IsLevel(2))) and c:IsFaceup()");
    expect(script).toContain("local e3=e2:Clone()");
    expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
    expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("local sp_chk=re and e:GetHandler():IsSpecialSummoned() and re:IsMonsterEffect() and re:GetHandler():IsOriginalType(TYPE_SYNCHRO)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,tp,-1000)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,tc,1,tp,0)");
    expect(script).toContain("op=Duel.SelectEffect(tp,");
    expect(script).toContain("tc:UpdateAttack(-1000,nil,e:GetHandler())");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const reader = createCardReader(cards(cookyData!));
    const procedureSession = createSession(reader);
    loadDecks(procedureSession, { 0: { main: [cookyCode, link1Code] }, 1: { main: [] } });
    startDuel(procedureSession);
    const procedureCooky = requireCard(procedureSession, cookyCode);
    const link1 = requireCard(procedureSession, link1Code);
    moveDuelCard(procedureSession.state, procedureCooky.uid, "hand", 0);
    moveFaceUpAttack(procedureSession, link1, 0);
    procedureSession.state.phase = "main1";
    procedureSession.state.turnPlayer = 0;
    procedureSession.state.waitingFor = 0;

    const procedureHost = createLuaScriptHost(procedureSession, workspace);
    expect(procedureHost.loadCardScript(Number(cookyCode), workspace).ok).toBe(true);
    expect(procedureHost.registerInitialEffects()).toBe(1);
    const restoredProcedure = restoreDuelWithLuaScripts(serializeDuel(procedureSession), workspace, reader);
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === procedureCooky.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureCooky.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "special",
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: procedureCooky.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { location: "hand", controller: 0, sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
      },
    ]);

    const source = helperSource(workspace);
    const branchSession = createSession(reader);
    loadDecks(branchSession, { 0: { main: [cookyCode, synchroSummonerCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(branchSession);
    const branchCooky = requireCard(branchSession, cookyCode);
    const synchroSummoner = requireCard(branchSession, synchroSummonerCode);
    const opponentTarget = requireCard(branchSession, opponentTargetCode);
    moveDuelCard(branchSession.state, branchCooky.uid, "hand", 0);
    moveFaceUpAttack(branchSession, synchroSummoner, 0);
    moveFaceUpAttack(branchSession, opponentTarget, 1);
    branchSession.state.phase = "main1";
    branchSession.state.turnPlayer = 0;
    branchSession.state.waitingFor = 0;

    const branchHost = createLuaScriptHost(branchSession, workspace);
    expect(branchHost.loadCardScript(Number(cookyCode), source).ok).toBe(true);
    expect(branchHost.loadCardScript(Number(synchroSummonerCode), source).ok).toBe(true);
    expect(branchHost.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(branchSession), source, reader, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }] });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summonEffect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === synchroSummoner.uid);
    expect(summonEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summonEffect!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === branchCooky.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: synchroSummoner.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1102",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: branchCooky.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: synchroSummoner.uid,
        eventReasonEffectId: 4,
        player: 0,
        sourceUid: branchCooky.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }] });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === branchCooky.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(trigger)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [1100966962, 1100966963], returned: 2 },
    ]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: branchCooky.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredTrigger.session.state)).toBe(1800);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: branchCooky.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: synchroSummoner.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previousLocation: "hand", currentLocation: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: branchCooky.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(cookyData: DuelCardData): DuelCardData[] {
  return [
    cookyData,
    { code: link1Code, name: "Cooky Yummy Link-1 Fixture", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceBeast, attribute: attributeLight, level: 1, attack: 500, defense: 0, linkMarkers: 0x20 },
    { code: synchroSummonerCode, name: "Cooky Yummy Synchro Effect Summoner", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceBeast, attribute: attributeLight, level: 2, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Cooky Yummy Opponent Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
}

function createSession(reader: ReturnType<typeof createCardReader>): DuelSession {
  return createDuel({ seed: 68810435, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
}

function helperSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): LuaScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${synchroSummonerCode}.lua`) return synchroSummonerScript();
      return workspace.readScript(name);
    },
  };
}

function synchroSummonerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetDescription(1)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.spfilter(c,e,tp)
      return c:IsCode(${cookyCode}) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_HAND,0,1,nil,e,tp) end
      Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
      local g=Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)
      if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP) end
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = restored.session.state.waitingFor;
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
