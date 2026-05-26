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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const engraverCode = "50078320";
const targetCode = "50078321";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Engraver of the Mark delayed destroy", () => {
  it("restores its targeted aux.DelayedOperation and destroys the marked card during the next turn End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${engraverCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)");
    expect(script).toContain("local turn_count=Duel.GetTurnCount()");
    expect(script).toContain("aux.DelayedOperation(tc,PHASE_END,id,e,tp,");
    expect(script).toContain("Duel.Destroy(ag,REASON_EFFECT)");
    expect(script).toContain("function() return Duel.GetTurnCount()==turn_count+1 end");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === engraverCode),
      { code: targetCode, name: "Engraver Delayed Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 50078320, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [engraverCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const engraver = requireCard(session, engraverCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, engraver.uid, 0);
    moveFaceUpAttack(session, target.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(engraverCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const delayedTarget = engraver;
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === engraver.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === delayedTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 0x1200 && effect.sourceUid === engraver.uid)).toHaveLength(1);
    expect(restoredOpen.session.state.flagEffects).toContainEqual(expect.objectContaining({ ownerType: "card", ownerId: delayedTarget.uid, code: Number(engraverCode) }));

    const restoredWatcher = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredWatcher);
    expectRestoredLegalActions(restoredWatcher, 0);
    expect(restoredWatcher.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 0x1200 && effect.sourceUid === engraver.uid)).toEqual([
      expect.objectContaining({ reset: { flags: 1073742336, count: 3 } }),
    ]);

    const restoredSameEnd = restoreDuelWithLuaScripts(serializeDuel(restoredWatcher.session), workspace, reader);
    expectCleanRestore(restoredSameEnd);
    advanceRestoredToEndTurn(restoredSameEnd, 0);
    expect(restoredSameEnd.session.state.cards.find((card) => card.uid === delayedTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredSameEnd.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === delayedTarget.uid)).toEqual([]);

    const restoredNextEnd = restoreDuelWithLuaScripts(serializeDuel(restoredSameEnd.session), workspace, reader);
    expectCleanRestore(restoredNextEnd);
    advanceRestoredToEndTurn(restoredNextEnd, 1);
    expect(restoredNextEnd.session.state.cards.find((card) => card.uid === delayedTarget.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredNextEnd.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === delayedTarget.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: delayedTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: engraver.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredNextEnd.session.state.effects.some((effect) => effect.event === "continuous" && effect.code === 0x1200 && effect.sourceUid === engraver.uid)).toBe(false);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestoredAction(restored, pass!);
  }
}

function advanceRestoredToEndTurn(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  for (const phase of ["battle", "main2", "end"] as const) {
    if (restored.session.state.turnPlayer !== player) return;
    if (restored.session.state.phase === phase) continue;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    if (!action) continue;
    applyRestoredAction(restored, action);
  }
  if (restored.session.state.turnPlayer !== player) return;
  const endTurn = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "endTurn");
  expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredAction(restored, endTurn!);
}
