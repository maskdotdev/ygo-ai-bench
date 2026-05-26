import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const squallCode = "90135989";
const playerMonsterCode = "901359890";
const opponentMonsterCode = "901359891";
const faceDownMonsterCode = "901359892";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSquallScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${squallCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceAqua = 0x40;
const attributeWater = 0x2;
const counterFog = 0x1019;

describe.skipIf(!hasUpstreamScripts || !hasSquallScript)("Lua real script Cloudian Squall standby counter", () => {
  it("restores turn-player Standby trigger adding Fog Counters to all face-up monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${squallCode}.lua`));
    const reader = createCardReader(cards());
    const restoredDraw = createRestoredSquallDraw({ reader, workspace });
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);

    const squall = requireCard(restoredDraw.session, squallCode);
    const playerMonster = requireCard(restoredDraw.session, playerMonsterCode);
    const opponentMonster = requireCard(restoredDraw.session, opponentMonsterCode);
    const faceDownMonster = requireCard(restoredDraw.session, faceDownMonsterCode);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-3-1",
        effectId: "lua-2-4098",
        sourceUid: squall.uid,
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    expect(restoredDraw.session.state.eventHistory.filter((event) => event.eventName === "phaseStandby")).toEqual([
      { eventName: "phaseStandby", eventCode: 0x1002 },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === squall.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, playerMonster.uid), counterFog)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, opponentMonster.uid), counterFog)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, faceDownMonster.uid), counterFog)).toBe(0);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "counterAdded").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterAdded", eventCardUid: playerMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: squall.uid, eventReasonEffectId: 2 },
      { eventName: "counterAdded", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: squall.uid, eventReasonEffectId: 2 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: squallCode, name: "Cloudian Squall", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: playerMonsterCode, name: "Squall Player Cloudian", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
    { code: opponentMonsterCode, name: "Squall Opponent Cloudian", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1400, defense: 1000 },
    { code: faceDownMonsterCode, name: "Squall Face-Down Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
  ];
}

function createRestoredSquallDraw({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 90135989, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [squallCode, playerMonsterCode] }, 1: { main: [opponentMonsterCode, faceDownMonsterCode] } });
  startDuel(session);
  moveFaceUpSpell(session, requireCard(session, squallCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, playerMonsterCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentMonsterCode), 1, 0);
  moveFaceDownDefense(session, requireCard(session, faceDownMonsterCode), 1, 1);
  session.state.turn = 2;
  session.state.turnPlayer = 0;
  session.state.phase = "draw";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(squallCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cloudian Squall");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("for tc in g:Iter() do");
  expect(script).toContain("tc:AddCounter(COUNTER_FOG,1)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDownDefense";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
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
