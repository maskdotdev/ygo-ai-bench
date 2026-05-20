import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { hasProcedureCompleteStatus, statusProcComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const lv3Code = "34088136";
const lv5Code = "34830502";
const opponentCode = "34088137";
const hasLv3Script = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lv3Code}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasLv3Script)("Lua real script Ultimate Insect LV3 Standby evolve summon", () => {
  it("restores flag-gated attack debuff and Standby self-to-Graveyard LV5 Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${lv3Code}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTargetRange(0,LOCATION_MZONE)");
    expect(script).toContain("return e:GetHandler():GetFlagEffect(id)~=0");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("e2:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("return tp==Duel.GetTurnPlayer() and e:GetHandler():GetFlagEffect(id+1)==0");
    expect(script).toContain("if e:GetHandler():GetSequence()<5 then ft=ft+1 end");
    expect(script).toContain("return c:IsCode(34830502) and c:IsCanBeSpecialSummoned(e,0,tp,true,true)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil,e,tp):GetFirst()");
    expect(script).toContain("tc:RegisterFlagEffect(34830502,RESET_EVENT|RESETS_STANDARD&~(RESET_LEAVE|RESET_TEMP_REMOVE),0,0)");
    expect(script).toContain("tc:CompleteProcedure()");

    const cards: DuelCardData[] = [
      { code: lv3Code, name: "Ultimate Insect LV3", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1400, defense: 900 },
      { code: lv5Code, name: "Ultimate Insect LV5", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, attack: 2300, defense: 900 },
      { code: opponentCode, name: "Ultimate Insect Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 34088136, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lv3Code, lv5Code] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const lv3 = requireCard(session, lv3Code);
    const lv5 = requireCard(session, lv5Code);
    const opponent = requireCard(session, opponentCode);
    const movedLv3 = moveDuelCard(session.state, lv3.uid, "monsterZone", 0);
    movedLv3.faceUp = true;
    movedLv3.position = "faceUpAttack";
    const movedOpponent = moveDuelCard(session.state, opponent.uid, "monsterZone", 1);
    movedOpponent.faceUp = true;
    movedOpponent.position = "faceUpAttack";
    session.state.flagEffects.push({
      ownerType: "card",
      ownerId: lv3.uid,
      code: Number(lv3Code),
      reset: 0,
      property: 0,
      value: 0,
      turn: 2,
    });
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "draw";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lv3Code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentAttack(opponent, session.state)).toBe(1500);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    expect(currentAttack(restoredDraw.session.state.cards.find((card) => card.uid === opponent.uid), restoredDraw.session.state)).toBe(1500);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-4098",
        sourceUid: lv3.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === lv3.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === lv3.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonCardUid: lv3.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === lv5.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      customStatusMask: statusProcComplete,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: lv3.uid,
      reasonEffectId: 2,
    });
    expect(hasProcedureCompleteStatus(restoredTrigger.session.state.cards.find((card) => card.uid === lv5.uid)!)).toBe(true);
    expect(restoredTrigger.session.state.flagEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerType: "card", ownerId: lv5.uid, code: Number(lv5Code) }),
    ]));
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: lv3.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: lv3.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: lv5.uid,
        eventUids: [lv5.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: lv3.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
