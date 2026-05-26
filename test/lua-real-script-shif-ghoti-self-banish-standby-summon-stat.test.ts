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
const shifCode = "73421698";
const fishTargetCode = "734216980";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasShifScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shifCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceFish = 0x20000;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasShifScript)("Lua real script Shif Ghoti self-banish standby summon stat", () => {
  it("restores grave SelfBanish Fish ATK boost and next-standby banished self-summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${shifCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredStat = createRestoredStatOpen({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const graveShif = requireCard(restoredStat.session, shifCode);
    const fishTarget = requireCard(restoredStat.session, fishTargetCode);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveShif.uid && action.effectId === "lua-1"
    );
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statAction!);

    expect(restoredStat.session.state.cards.find((card) => card.uid === graveShif.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveShif.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === fishTarget.uid), restoredStat.session.state)).toBe(2000);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "becameTarget")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveShif.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveShif.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: fishTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStandby = createRestoredStandbyOpen({ reader, workspace });
    expectCleanRestore(restoredStandby);
    expectRestoredLegalActions(restoredStandby, 0);
    const banishedShif = requireCard(restoredStandby.session, shifCode);
    const summonAction = getLuaRestoreLegalActions(restoredStandby, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === banishedShif.uid && action.effectId === "lua-2-4098"
    );
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredStandby, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStandby, summonAction!);
    resolveRestoredChain(restoredStandby);

    expect(restoredStandby.session.state.cards.find((card) => card.uid === banishedShif.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: banishedShif.uid,
      reasonEffectId: 2,
    });
    expect(restoredStandby.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: banishedShif.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: banishedShif.uid, eventReasonEffectId: 2, previous: "banished", current: "monsterZone" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: shifCode, name: "Shif, Fairy of the Ghoti", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceFish, attribute: attributeWater, level: 2, attack: 0, defense: 500 },
    { code: fishTargetCode, name: "Shif Ghoti Fish Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1500, defense: 1200 },
  ];
}

function createRestoredStatOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 73421698, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [shifCode, fishTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, shifCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, fishTargetCode), 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(shifCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredStandbyOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 73421699, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [shifCode] }, 1: { main: [] } });
  startDuel(session);
  const shif = requireCard(session, shifCode);
  moveDuelCard(session.state, shif.uid, "banished", 0);
  shif.turnId = 1;
  session.state.turn = 2;
  session.state.phase = "draw";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(shifCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const standby = getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
  expect(standby, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  const response = applyResponse(session, standby!);
  expect(response.ok, response.error).toBe(true);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Shif, Fairy of the Ghoti");
  expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_FISH),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return Duel.GetTurnCount()==e:GetHandler():GetTurnID()+1");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SynchroSummon(tp,sg:GetFirst(),c)");
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
