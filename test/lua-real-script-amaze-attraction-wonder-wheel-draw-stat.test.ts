import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const wonderWheelCode = "93473606";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWonderWheelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wonderWheelCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasWonderWheelScript)("Lua real script Amaze Attraction Wonder Wheel draw stat", () => {
  it("restores equipped self hand-to-bottom draw and opponent ATK/DEF swap branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const selfTargetCode = "934736060";
    const opponentTargetCode = "934736061";
    const handCardCode = "934736062";
    const drawCardCode = "934736063";
    const script = workspace.readScript(`official/c${wonderWheelCode}.lua`);
    expect(script).toContain("aux.AddAttractionEquipProc(c)");
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_DRAW)");
    expect(script).toContain("e1:SetCondition(aux.AttractionEquipCon(true))");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)");
    expect(script).toContain("Duel.SelectMatchingCard(p,aux.TRUE,p,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_EFFECT)");
    expect(script).toContain("Duel.Draw(p,1,REASON_EFFECT)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetCondition(aux.AttractionEquipCon(false))");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(def)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(atk)");

    const cards: DuelCardData[] = [
      { code: wonderWheelCode, name: "Amaze Attraction Wonder Wheel", kind: "trap", typeFlags: typeTrap },
      { code: selfTargetCode, name: "Wonder Wheel Self Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 800 },
      { code: opponentTargetCode, name: "Wonder Wheel Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2100, defense: 600 },
      { code: handCardCode, name: "Wonder Wheel Bottom Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: drawCardCode, name: "Wonder Wheel Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 93473606, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wonderWheelCode, selfTargetCode, handCardCode, drawCardCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const wonderWheel = requireCard(session, wonderWheelCode);
    const selfTarget = requireCard(session, selfTargetCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const handCard = requireCard(session, handCardCode);
    const drawCard = requireCard(session, drawCardCode);
    moveDuelCard(session.state, wonderWheel.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, selfTarget, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    moveDuelCard(session.state, handCard.uid, "hand", 0);
    wonderWheel.equippedToUid = selfTarget.uid;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wonderWheelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredDrawOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDrawOpen);
    expectRestoredLegalActions(restoredDrawOpen, 0);
    const drawAction = getLuaRestoreLegalActions(restoredDrawOpen, 0).find((action) => action.type === "activateEffect" && action.uid === wonderWheel.uid && action.effectId === "lua-2-1002");
    expect(drawAction, JSON.stringify(getLuaRestoreLegalActions(restoredDrawOpen, 0), null, 2)).toBeDefined();
    expect(drawAction).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredDrawOpen, drawAction!);
    resolveRestoredChain(restoredDrawOpen);

    expect(restoredDrawOpen.session.state.cards.find((card) => card.uid === handCard.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredDrawOpen.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredDrawOpen.session.state.eventHistory.filter((event) => ["sentToDeck", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: handCard.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wonderWheel.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [drawCard.uid],
        eventCardUid: drawCard.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wonderWheel.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const statSession = createDuel({ seed: 93473607, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [wonderWheelCode, selfTargetCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(statSession);
    const statWonderWheel = requireCard(statSession, wonderWheelCode);
    const statOpponentTarget = requireCard(statSession, opponentTargetCode);
    moveDuelCard(statSession.state, statWonderWheel.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(statSession, statOpponentTarget, 1);
    statWonderWheel.equippedToUid = statOpponentTarget.uid;
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(wonderWheelCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStatSeed = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStatSeed);
    expectRestoredLegalActions(restoredStatSeed, 0);
    const statAction = getLuaRestoreLegalActions(restoredStatSeed, 0).find((action) => action.type === "activateEffect" && action.uid === statWonderWheel.uid && action.effectId === "lua-3-1002");
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStatSeed, 0), null, 2)).toBeDefined();
    expect(statAction).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredStatSeed, statAction!);
    resolveRestoredChain(restoredStatSeed);

    const restoredOpponentTarget = restoredStatSeed.session.state.cards.find((card) => card.uid === statOpponentTarget.uid);
    expect(currentAttack(restoredOpponentTarget, restoredStatSeed.session.state)).toBe(600);
    expect(currentDefense(restoredOpponentTarget, restoredStatSeed.session.state)).toBe(2100);
  });
});

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
