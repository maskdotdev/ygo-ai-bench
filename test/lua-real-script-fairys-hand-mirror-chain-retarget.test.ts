import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const fairyMirrorCode = "17653779";
const bookOfMoonCode = "14087893";
const hasFairyMirrorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fairyMirrorCode}.lua`));
const hasBookOfMoonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bookOfMoonCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeQuickPlay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasFairyMirrorScript || !hasBookOfMoonScript)("Lua real script Fairy's Hand Mirror chain retarget", () => {
  it("restores CheckChainTarget and ChangeTargetCard retargeting Book of Moon to a new monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const originalTargetCode = "176537790";
    const replacementTargetCode = "176537791";
    const fairyScript = workspace.readScript(`c${fairyMirrorCode}.lua`);
    const bookScript = workspace.readScript(`c${bookOfMoonCode}.lua`);
    expect(fairyScript).toContain("Duel.CheckChainTarget(ct,c)");
    expect(fairyScript).toContain("Duel.ChangeTargetCard(ev,g)");
    expect(bookScript).toContain("Duel.SelectTarget(tp,Card.IsCanTurnSet,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(bookScript).toContain("Duel.ChangePosition(tc,POS_FACEDOWN_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: fairyMirrorCode, name: "Fairy's Hand Mirror", kind: "trap", typeFlags: typeTrap },
      { code: bookOfMoonCode, name: "Book of Moon", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
      { code: originalTargetCode, name: "Fairy Mirror Original Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: replacementTargetCode, name: "Fairy Mirror Replacement Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 17653779, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fairyMirrorCode, originalTargetCode, replacementTargetCode] }, 1: { main: [bookOfMoonCode] } });
    startDuel(session);

    const fairyMirror = requireCard(session, fairyMirrorCode);
    const bookOfMoon = requireCard(session, bookOfMoonCode);
    const originalTarget = requireCard(session, originalTargetCode);
    const replacementTarget = requireCard(session, replacementTargetCode);
    const movedMirror = moveDuelCard(session.state, fairyMirror.uid, "spellTrapZone", 0);
    movedMirror.faceUp = false;
    movedMirror.position = "faceDown";
    movedMirror.turnId = 0;
    moveDuelCard(session.state, bookOfMoon.uid, "hand", 1);
    const movedOriginal = moveDuelCard(session.state, originalTarget.uid, "monsterZone", 0);
    movedOriginal.faceUp = true;
    movedOriginal.position = "faceUpAttack";
    movedOriginal.sequence = 0;
    const movedReplacement = moveDuelCard(session.state, replacementTarget.uid, "monsterZone", 0);
    movedReplacement.faceUp = true;
    movedReplacement.position = "faceUpAttack";
    movedReplacement.sequence = 1;
    session.state.turn = 1;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fairyMirrorCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(bookOfMoonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const bookAction = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === bookOfMoon.uid);
    expect(bookAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, bookAction!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: bookOfMoon.uid,
        player: 1,
        effectId: "lua-2-1002",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x1000, targetUids: [originalTarget.uid], count: 1, player: 1, parameter: 8 }],
        targetFieldIds: [7],
        targetUids: [originalTarget.uid],
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const mirrorAction = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === fairyMirror.uid);
    expect(mirrorAction, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    expect(mirrorAction?.windowKind).toBe("chainResponse");
    applyRestoredActionAndAssert(restoredResponse, mirrorAction!);
    expect(restoredResponse.session.state.chain).toEqual([]);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === originalTarget.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpAttack",
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === replacementTarget.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceDownDefense",
      faceUp: false,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === fairyMirror.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === bookOfMoon.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredResponse.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: replacementTarget.uid,
        eventReason: 64,
        eventReasonPlayer: 1,
        eventReasonCardUid: bookOfMoon.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 1 },
      },
    ]);
    expect(restoredResponse.host.messages).toEqual([]);
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
