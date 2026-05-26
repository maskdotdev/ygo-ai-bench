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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const indigoCode = "16699558";
const hasIndigoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${indigoCode}.lua`));
const materialCode = "166995580";
const normalCode = "166995581";
const battleTargetCode = "166995582";
const responderCode = "166995583";
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasIndigoScript)("Lua real script Indigo-Eyes Silver Dragon detach revive stat", () => {
  it("restores detach cost into targeted Normal Monster revive and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${indigoCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_DRAGON),8,2)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Card.IsNegatable");
    expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1,1))");
    expect(script).toContain("return c:IsType(TYPE_NORMAL) and c:IsFaceup() and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE|LOCATION_REMOVED,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,0)");
    expect(script).toContain("tc:UpdateAttack(1000,RESET_EVENT|RESETS_STANDARD,e:GetHandler())");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === indigoCode),
      { code: materialCode, name: "Indigo-Eyes Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 8, attack: 1600, defense: 1000 },
      { code: normalCode, name: "Indigo-Eyes Normal Revive Target", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceDragon, level: 8, attack: 2000, defense: 1800 },
      { code: battleTargetCode, name: "Indigo-Eyes Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2500, defense: 1200 },
      { code: responderCode, name: "Indigo-Eyes Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 16699558, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, normalCode], extra: [indigoCode] }, 1: { main: [battleTargetCode, responderCode] } });
    startDuel(session);

    const indigo = requireCard(session, indigoCode);
    const material = requireCard(session, materialCode);
    const normal = requireCard(session, normalCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, indigo.uid, "monsterZone", 0);
    indigo.position = "faceUpAttack";
    indigo.faceUp = true;
    indigo.summonType = "xyz";
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    indigo.overlayUids.push(material.uid);
    moveDuelCard(session.state, normal.uid, "graveyard", 0);
    normal.faceUp = true;
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1);
    battleTarget.position = "faceUpAttack";
    battleTarget.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(indigoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === indigo.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: indigo.uid,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === indigo.uid)).toMatchObject({
      location: "monsterZone",
      overlayUids: [],
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-4",
        sourceUid: indigo.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetFieldIds: [8],
        targetUids: [normal.uid],
        operationInfos: [{ category: 0x200, count: 1, parameter: 0, player: 0, targetUids: [normal.uid] }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredChain, 1);
    expect(restoredChain.host.messages).not.toContain("indigo eyes responder resolved");

    const revived = requireCard(restoredChain.session, normalCode);
    expect(revived).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: indigo.uid,
    });
    expect(revived.attackModifier).toBe(1000);
    expect(currentAttack(revived, restoredChain.session.state)).toBe(3000);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["detachedMaterial", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: indigo.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: normal.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: indigo.uid,
        eventReasonEffectId: 4,
        eventUids: [normal.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.waitingFor = 0;
    const attack = getLegalActions(restoredChain.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === revived.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(restoredChain.session, 0), null, 2)).toBeDefined();
    const attackResponse = applyResponse(restoredChain.session, attack!);
    expect(attackResponse.ok, attackResponse.error).toBe(true);
    passBattleResponses(restoredChain.session);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredChain.session.state.cards.find((card) => card.uid === revived.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({ location: "graveyard" });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("indigo eyes responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
