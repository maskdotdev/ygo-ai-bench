import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const scoutPlaneCode = "3773196";
const hasScoutPlaneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${scoutPlaneCode}.lua`));
const blockerCode = "3773197";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasScoutPlaneScript)("Lua real script D.D. Scout Plane banished End Phase return", () => {
  it("restores mandatory banished End Phase self Special Summon and no-zone Graveyard fallback", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${scoutPlaneCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
    expect(script).toContain("e1:SetCode(EVENT_REMOVE)");
    expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("e2:SetRange(LOCATION_REMOVED)");
    expect(script).toContain("return e:GetHandler():GetFlagEffect(id)~=0");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(script).toContain("e:GetHandler():RegisterFlagEffect(id+1,RESET_EVENT|RESET_TURN_SET|RESET_TOGRAVE|RESET_TEMP_REMOVE|RESET_TOHAND|RESET_TODECK|RESET_OVERLAY|RESET_PHASE|PHASE_END,0,1)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_ATTACK)");

    const cards: DuelCardData[] = [
      { code: scoutPlaneCode, name: "D.D. Scout Plane", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 800, defense: 1200 },
      { code: blockerCode, name: "Scout Plane Zone Blocker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3773196, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scoutPlaneCode, blockerCode, blockerCode, blockerCode, blockerCode, blockerCode] }, 1: { main: [] } });
    startDuel(session);

    const scout = requireCard(session, scoutPlaneCode);
    const blockers = session.state.cards.filter((card) => card.code === blockerCode);
    expect(blockers).toHaveLength(5);
    const movedScout = moveDuelCard(session.state, scout.uid, "banished", 0);
    movedScout.faceUp = true;
    movedScout.position = "faceUpAttack";
    session.state.flagEffects.push({
      ownerType: "card",
      ownerId: scout.uid,
      code: Number(scoutPlaneCode),
      reset: 0,
      property: 0,
      value: 0,
      turn: 2,
    });
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main2";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(scoutPlaneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredMain2 = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMain2);
    expectRestoredLegalActions(restoredMain2, 0);
    const end = getLuaRestoreLegalActions(restoredMain2, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredMain2, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredMain2, end!);
    expect(restoredMain2.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-4608",
        sourceUid: scout.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "phaseEnd",
        eventCode: 0x1200,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredMain2.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === scout.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === scout.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: scout.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === scout.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: scout.uid,
        eventUids: [scout.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: scout.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const noZone = restoreDuelWithLuaScripts(serializeDuel(restoredMain2.session), workspace, reader);
    for (const [index, blocker] of blockers.entries()) {
      const moved = moveDuelCard(noZone.session.state, blocker.uid, "monsterZone", 0);
      moved.sequence = index;
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    }
    expectCleanRestore(noZone);
    expectRestoredLegalActions(noZone, 0);
    const noZoneTrigger = getLuaRestoreLegalActions(noZone, 0).find((action) => action.type === "activateTrigger" && action.uid === scout.uid);
    expect(noZoneTrigger, JSON.stringify(getLuaRestoreLegalActions(noZone, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(noZone, noZoneTrigger!);
    expect(noZone.session.state.cards.find((card) => card.uid === scout.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: scout.uid,
      reasonEffectId: 2,
    });
    expect(noZone.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === scout.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: scout.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: scout.uid,
        eventReasonEffectId: 2,
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
