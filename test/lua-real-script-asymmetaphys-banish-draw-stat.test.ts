import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setMetaphys = 0x105;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Asymmetaphys banish draw stat", () => {
  it("restores hand Metaphys banish draw into own-turn non-Metaphys ATK/DEF reductions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const asymmetaphysCode = "66719533";
    const handMetaphysCode = "667195330";
    const drawCode = "667195331";
    const ownNonMetaphysCode = "667195332";
    const opponentNonMetaphysCode = "667195333";
    const ownMetaphysCode = "667195334";
    const script = workspace.readScript(`c${asymmetaphysCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE+CATEGORY_DRAW)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.drfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
    expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
    expect(script).toContain("e3:SetCode(EVENT_REMOVE)");
    expect(script).toContain("return s.effcon(e,tp,eg,ep,ev,re,r,rp) and Duel.IsTurnPlayer(tp)");
    expect(script).toContain("Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === asymmetaphysCode),
      { code: handMetaphysCode, name: "Asymmetaphys Hand Metaphys", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMetaphys], level: 4, attack: 1500, defense: 1000 },
      { code: drawCode, name: "Asymmetaphys Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: ownNonMetaphysCode, name: "Asymmetaphys Own Non-Metaphys", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1600 },
      { code: opponentNonMetaphysCode, name: "Asymmetaphys Opponent Non-Metaphys", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1500 },
      { code: ownMetaphysCode, name: "Asymmetaphys Own Metaphys Survivor", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMetaphys], level: 4, attack: 1900, defense: 1700 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 66719533, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asymmetaphysCode, handMetaphysCode, drawCode, ownNonMetaphysCode, ownMetaphysCode] }, 1: { main: [opponentNonMetaphysCode] } });
    startDuel(session);

    const asymmetaphys = requireCard(session, asymmetaphysCode);
    const handMetaphys = requireCard(session, handMetaphysCode);
    const drawCard = requireCard(session, drawCode);
    const ownNonMetaphys = requireCard(session, ownNonMetaphysCode);
    const opponentNonMetaphys = requireCard(session, opponentNonMetaphysCode);
    const ownMetaphys = requireCard(session, ownMetaphysCode);
    moveDuelCard(session.state, asymmetaphys.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, handMetaphys.uid, "hand", 0);
    moveDuelCard(session.state, ownNonMetaphys.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ownMetaphys.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentNonMetaphys.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(asymmetaphysCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === asymmetaphys.uid && action.effectId === "lua-2");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === handMetaphys.uid)).toMatchObject({ location: "banished", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: handMetaphys.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: asymmetaphys.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
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
        eventReasonCardUid: asymmetaphys.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === asymmetaphys.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, statTrigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownNonMetaphys.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === ownNonMetaphys.uid), restoredTrigger.session.state)).toBe(1100);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentNonMetaphys.uid), restoredTrigger.session.state)).toBe(1200);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === opponentNonMetaphys.uid), restoredTrigger.session.state)).toBe(1000);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownMetaphys.uid), restoredTrigger.session.state)).toBe(1900);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === ownMetaphys.uid), restoredTrigger.session.state)).toBe(1700);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
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
