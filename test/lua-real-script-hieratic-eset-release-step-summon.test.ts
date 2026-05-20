import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const esetCode = "4022819";
const hasEsetScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${esetCode}.lua`));
const starterCode = "402281901";
const normalDragonCode = "402281902";
const responderCode = "402281903";
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeSpell = 0x2;
const raceDragon = 0x2000;
const setHieratic = 0x69;

describe.skipIf(!hasUpstreamScripts || !hasEsetScript)("Lua real script Hieratic Dragon of Eset release step summon", () => {
  it("restores EVENT_RELEASE mandatory trigger into Dragon Normal SpecialSummonStep with zero stats", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${esetCode}.lua`);
    expect(script).toContain("e3:SetCode(EVENT_RELEASE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE)");
    expect(script).toContain("Duel.SpecialSummonStep(sc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE)");
    expect(script).toContain("Duel.SpecialSummonComplete()");

    const cards: DuelCardData[] = [
      { code: esetCode, name: "Hieratic Dragon of Eset", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 5, attack: 1900, defense: 1200, setcodes: [setHieratic] },
      { code: starterCode, name: "Hieratic Eset Release Starter", kind: "spell", typeFlags: typeSpell },
      { code: normalDragonCode, name: "Hieratic Eset Normal Dragon", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceDragon, level: 6, attack: 2100, defense: 1600 },
      { code: responderCode, name: "Hieratic Eset Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4022819, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [esetCode, starterCode, normalDragonCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const eset = requireCard(session, esetCode);
    const starter = requireCard(session, starterCode);
    const normalDragon = requireCard(session, normalDragonCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, eset.uid, "monsterZone", 0).position = "faceUpAttack";
    eset.faceUp = true;
    moveDuelCard(session.state, starter.uid, "hand", 0);
    moveDuelCard(session.state, normalDragon.uid, "deck", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return releaseStarterScript(esetCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(esetCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);

    const restoredStarterChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredStarterChain);
    expectRestoredLegalActions(restoredStarterChain, 1);
    const starterPass = getLuaRestoreLegalActions(restoredStarterChain, 1).find((action) => action.type === "passChain");
    expect(starterPass).toBeDefined();
    const starterResolved = applyLuaRestoreResponse(restoredStarterChain, starterPass!);
    expect(starterResolved.ok, starterResolved.error).toBe(true);
    expect(restoredStarterChain.session.state.cards.find((card) => card.uid === eset.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: starter.uid,
      reasonEffectId: 4,
    });
    expect(restoredStarterChain.session.state.pendingTriggers).toMatchObject([
      {
        sourceUid: eset.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "released",
        eventCode: 1017,
        eventCardUid: eset.uid,
        eventReason: duelReason.effect | duelReason.release,
        eventReasonPlayer: 0,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredStarterChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === eset.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([{
      id: "chain-6",
      chainIndex: 1,
      effectId: "lua-3-1017",
      sourceUid: eset.uid,
      player: 0,
      activationLocation: "graveyard",
      activationSequence: 0,
      eventName: "released",
      eventCode: 1017,
      eventCardUid: eset.uid,
      eventReason: duelReason.effect | duelReason.release,
      eventReasonPlayer: 0,
      eventReasonCardUid: starter.uid,
      eventReasonEffectId: 4,
      eventTriggerTiming: "when",
      eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      operationInfos: [{ category: 0x200, count: 1, parameter: 0x13, player: 0, targetUids: [] }],
    }]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, 1);
    const summonPass = getLuaRestoreLegalActions(restoredSummonChain, 1).find((action) => action.type === "passChain");
    expect(summonPass).toBeDefined();
    const summonResolved = applyLuaRestoreResponse(restoredSummonChain, summonPass!);
    expect(summonResolved.ok, summonResolved.error).toBe(true);

    const summonedDragon = restoredSummonChain.session.state.cards.find((card) => card.uid === normalDragon.uid);
    expect(summonedDragon).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: eset.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(summonedDragon, restoredSummonChain.session.state)).toBe(0);
    expect(currentDefense(summonedDragon, restoredSummonChain.session.state)).toBe(0);
    expect(restoredSummonChain.session.state.effects.filter((effect) => effect.sourceUid === normalDragon.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 101, event: "continuous", reset: { flags: 33427456 }, value: 0 },
      { code: 105, event: "continuous", reset: { flags: 33427456 }, value: 0 },
    ]);
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => event.eventName === "released" || event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: eset.uid,
        eventReason: duelReason.effect | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: starter.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: normalDragon.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: eset.uid,
        eventReasonEffectId: 3,
        eventUids: [normalDragon.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredSummonChain.host.messages).not.toContain("hieratic eset responder resolved");
  });
});

function releaseStarterScript(esetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${esetCode}),tp,LOCATION_MZONE,0,nil)
        Duel.Release(tc,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("hieratic eset responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}
