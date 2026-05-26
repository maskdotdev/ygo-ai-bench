import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bunnyCode = "39643167";
const targetCode = "990396431";
const decoyCode = "990396432";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBunnyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bunnyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeastWarrior = 0x4000;
const attributeEarth = 0x10;
const counterBunnyEars = 0x1208;
const standbyPhaseCode = 0x1002;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBunnyScript)("Lua real script Bunny Ear Enthusiast counter remove", () => {
  it("restores counter-targeted temporary banish and next-standby field return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bunnyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredRemove = createRestoredRemoveState(reader, workspace);
    expectCleanRestore(restoredRemove);
    expectRestoredLegalActions(restoredRemove, 0);
    const bunny = requireCard(restoredRemove.session, bunnyCode);
    const target = requireCard(restoredRemove.session, targetCode);
    const remove = getLuaRestoreLegalActions(restoredRemove, 0).find((action) =>
      action.type === "activateEffect" && action.uid === bunny.uid && action.effectId === "lua-2-1002"
    );
    expect(remove, JSON.stringify(getLuaRestoreLegalActions(restoredRemove, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemove, remove!);
    resolveRestoredChain(restoredRemove);

    for (const card of [bunny, target]) {
      expect(findCard(restoredRemove.session, card.uid)).toMatchObject({
        location: "banished",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: bunny.uid,
        reasonEffectId: 2,
      });
    }
    expect(restoredRemove.session.state.effects.filter((effect) => effect.sourceUid === bunny.uid && effect.code === standbyPhaseCode).map((effect) => ({
      code: effect.code,
      labelObjectUid: effect.labelObjectUid,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: standbyPhaseCode, labelObjectUid: undefined, reset: { flags: 1073741826, count: 1 }, sourceUid: bunny.uid },
    ]);
    expect(restoredRemove.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: bunny.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bunny.uid, eventReasonEffectId: 2, eventUids: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bunny.uid, eventReasonEffectId: 2, eventUids: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: bunny.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bunny.uid, eventReasonEffectId: 2, eventUids: [bunny.uid, target.uid] },
    ]);

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(restoredRemove.session), workspace, reader);
    expectCleanRestore(restoredReturn);
    restoredReturn.session.state.turn = 2;
    restoredReturn.session.state.turnPlayer = 0;
    restoredReturn.session.state.phase = "draw";
    restoredReturn.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredReturn, 0);
    const standby = getLuaRestoreLegalActions(restoredReturn, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, standby!);
    for (const card of [bunny, target]) {
      expect(findCard(restoredReturn.session, card.uid)).toMatchObject({
        location: "monsterZone",
        controller: card.controller,
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: bunny.uid,
        reasonEffectId: 3,
      });
    }
  });
});

function createRestoredRemoveState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 39643167, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [bunnyCode, decoyCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  const bunny = moveFaceUpAttack(session, requireCard(session, bunnyCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, decoyCode), 0, 1);
  const target = moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  expect(addDuelCardCounter(target, counterBunnyEars, 1)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBunny(session, workspace);
  expect(bunny.faceUp).toBe(true);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const bunny = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === bunnyCode);
  expect(bunny).toBeDefined();
  return [
    bunny!,
    { code: targetCode, name: "Bunny Ear Temporary Banish Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: decoyCode, name: "Bunny Ear Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 1300, defense: 1000 },
  ];
}

function registerBunny(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(bunnyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Bunny Ear Enthusiast");
  expect(script).toContain("s.counter_place_list={0x1208}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return re:IsMonsterEffect() and re:GetActivateLocation()==LOCATION_MZONE and not re:GetHandler():IsCode(id)");
  expect(script).toContain("rc:AddCounter(0x1208,1)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c)");
  expect(script).toContain("local reset_count=Duel.GetCurrentPhase()<=PHASE_STANDBY and 2 or 1");
  expect(script).toContain("aux.RemoveUntil(rg,nil,REASON_EFFECT,PHASE_STANDBY,id+100,e,tp,aux.DefaultFieldReturnOp");
  expect(script).toContain("function() return Duel.GetTurnCount()==turn_chk+1 end");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
