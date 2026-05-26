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
const corruptionCellCode = "2561846";
const targetCode = "25618460";
const decoyCode = "25618461";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCorruptionCellScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${corruptionCellCode}.lua`));
const counterA = 0x100e;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasCorruptionCellScript)("Lua real script Corruption Cell A counter", () => {
  it("restores targeted activation into one A-Counter on an opponent face-up monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${corruptionCellCode}.lua`));
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const corruptionCell = requireCard(restoredOpen.session, corruptionCellCode);
    const target = requireCard(restoredOpen.session, targetCode);
    const decoy = requireCard(restoredOpen.session, decoyCode);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === corruptionCell.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(findCard(restoredOpen.session, corruptionCell.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(getDuelCardCounter(findCard(restoredOpen.session, target.uid), counterA)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredOpen.session, decoy.uid), counterA)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "counterAdded", "sentToGraveyard"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: corruptionCell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: corruptionCell.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: corruptionCellCode, name: 'Corruption Cell "A"', kind: "spell", typeFlags: typeSpell },
    { code: targetCode, name: "Corruption Cell A Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: decoyCode, name: "Corruption Cell A Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 2561846, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [corruptionCellCode] }, 1: { main: [targetCode, decoyCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, corruptionCellCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, decoyCode), 1, 1);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(corruptionCellCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain('--Corruption Cell "A"');
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)");
  expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
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

function slimEvent(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
  return {
    eventCardUid: event.eventCardUid,
    eventCode: event.eventCode,
    eventName: event.eventName,
    eventReason: event.eventReason,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventReasonPlayer: event.eventReasonPlayer,
  };
}
