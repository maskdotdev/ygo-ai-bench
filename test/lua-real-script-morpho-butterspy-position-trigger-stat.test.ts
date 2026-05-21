import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const morphoCode = "43573231";
const opponentCode = "435732310";
const decoyCode = "435732311";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMorphoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${morphoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasMorphoScript)("Lua real script Morpho Butterspy position trigger stat", () => {
  it("restores EVENT_CHANGE_POS event-group target selection into opponent ATK/DEF loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${morphoCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_CHANGE_POS)");
    expect(script).toContain("eg:FilterSelect(tp,s.cfilter,1,1,nil,e,1-tp)");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-1000)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: morphoCode, name: "Morpho Butterspy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1600 },
      { code: opponentCode, name: "Morpho Position Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1500 },
      { code: decoyCode, name: "Morpho Same-Side Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 43573231, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [morphoCode, decoyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);
    const morpho = requireCard(session, morphoCode);
    const target = requireCard(session, opponentCode);
    const decoy = requireCard(session, decoyCode);
    moveFaceUpAttack(session, morpho, 0);
    moveFaceUpAttack(session, decoy, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(morphoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const change = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "changePosition" && action.uid === target.uid && action.position === "faceUpDefense");
    expect(change, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, change!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === morpho.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 1);
    const restoredTarget = restoredResolved.session.state.cards.find((card) => card.uid === target.uid);
    const restoredDecoy = restoredResolved.session.state.cards.find((card) => card.uid === decoy.uid);
    expect(currentAttack(restoredTarget, restoredResolved.session.state)).toBe(800);
    expect(currentDefense(restoredTarget, restoredResolved.session.state)).toBe(500);
    expect(currentAttack(restoredDecoy, restoredResolved.session.state)).toBe(1000);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, value: -1000 },
      { code: 104, reset: { flags: 33427456 }, value: -1000 },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: ReturnType<typeof requireCard>, player: PlayerId): void {
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
