import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const neptuneCode = "14357527";
const insectACode = "143575270";
const insectBCode = "143575271";
const insectCCode = "143575272";
const insectTargetCode = "143575273";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNeptuneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${neptuneCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceInsect = 0x800;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const phaseEndCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasNeptuneScript)("Lua real script Heavy Beetrooper Neptune procedure revive end stat", () => {
  it("restores banished-Insect procedure shuffle cost, opponent-effect return, and End Phase Insect ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${neptuneCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredProcedure = createRestoredProcedureWindow({ reader, workspace });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedureNeptune = requireCard(restoredProcedure.session, neptuneCode);
    const costA = requireCard(restoredProcedure.session, insectACode);
    const costB = requireCard(restoredProcedure.session, insectBCode);
    const costC = requireCard(restoredProcedure.session, insectCCode);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === procedureNeptune.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureNeptune.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    for (const cost of [costA, costB, costC]) {
      expect(restoredProcedure.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
        location: "deck",
        controller: 0,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: procedureNeptune.uid,
        reasonEffectId: 2,
      });
    }

    const restoredEnd = createRestoredFieldNeptune({ reader, workspace });
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const endNeptune = requireCard(restoredEnd.session, neptuneCode);
    const target = requireCard(restoredEnd.session, insectTargetCode);
    restoredEnd.session.state.phase = "main2";
    restoredEnd.session.state.waitingFor = 0;
    const end = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, end!);
    const stat = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "activateTrigger" && action.uid === endNeptune.uid);
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, stat!);
    passRestoredChain(restoredEnd);
    expect(currentAttack(restoredEnd.session.state.cards.find((card) => card.uid === target.uid), restoredEnd.session.state)).toBe(2500);
    expect(restoredEnd.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: target.uid, value: 1000 },
    ]);
    expect(restoredEnd.session.state.eventHistory.filter((event) => ["destroyed", "banished", "phaseEnd", "becameTarget", "sentToDeck", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toContainEqual({ eventName: "phaseEnd", eventCode: phaseEndCode, eventCardUid: undefined, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined });
    expect(restoredEnd.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredProcedureWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 14357527, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [neptuneCode, insectACode, insectBCode, insectCCode, insectTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, neptuneCode).uid, "hand", 0);
  for (const code of [insectACode, insectBCode, insectCCode]) {
    const card = requireCard(session, code);
    const moved = banishDuelCard(session.state, card.uid, 0, duelReason.effect, 0);
    moved.faceUp = true;
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  loadNeptune(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredFieldNeptune({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 14357528, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [neptuneCode, insectACode, insectBCode, insectCCode, insectTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, neptuneCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, insectTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  loadNeptune(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function loadNeptune(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(neptuneCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Heavy Beetrooper Mighty Neptune");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_REMOVED,0,3,nil)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_COST)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e3:SetCode(EVENT_REMOVE)");
  expect(script).toContain("Duel.IsMainPhase() and c:IsReason(REASON_EFFECT) and rp==1-tp");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: neptuneCode, name: "Heavy Beetrooper Mighty Neptune", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 8, attack: 3000, defense: 3000 },
    { code: insectACode, name: "Mighty Neptune Banished Insect A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: insectBCode, name: "Mighty Neptune Banished Insect B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 4, attack: 1100, defense: 1000 },
    { code: insectCCode, name: "Mighty Neptune Banished Insect C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: insectTargetCode, name: "Mighty Neptune End Phase Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = banishSafeMoveToMonster(session, card, player);
  moved.sequence = sequence;
  return moved;
}

function banishSafeMoveToMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = session.state.cards.find((candidate) => candidate.uid === card.uid)!;
  moved.location = "monsterZone";
  moved.controller = player;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
