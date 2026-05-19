import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const ehrenCode = "44178886";
const hasEhrenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ehrenCode}.lua`));

describe.skipIf(!hasUpstreamScripts || !hasEhrenScript)("Lua real script Ehren battle confirm to Deck", () => {
  it("restores battle-confirm target shuffling and ends the pending battle when the target leaves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "4417";
    const script = workspace.readScript(`c${ehrenCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_CONFIRM)");
    expect(script).toContain("local t=Duel.GetAttackTarget()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,t,1,0,0)");
    expect(script).toContain("Duel.SendtoDeck(t,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: ehrenCode, name: "Ehren, Lightsworn Monk", kind: "monster", typeFlags: 0x1 | 0x20, level: 4, attack: 1600, defense: 1000 },
      { code: targetCode, name: "Ehren Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 1900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 441, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ehrenCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const ehren = session.state.cards.find((card) => card.code === ehrenCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(ehren).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, ehren!.uid, "monsterZone", 0);
    ehren!.position = "faceUpAttack";
    ehren!.faceUp = true;
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.position = "faceUpDefense";
    target!.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ehrenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ehren!.uid && action.targetUid === target!.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session, "battleConfirmed");

    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(session.state.pendingTriggers).toMatchObject([
      {
        eventName: "battleConfirmed",
        eventCode: 1133,
        eventCardUid: ehren!.uid,
        eventUids: [ehren!.uid, target!.uid],
        player: 0,
        sourceUid: ehren!.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === ehren!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredAndAssert(restored, trigger!);
    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === ehren!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "deck",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ehren!.uid,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["battleConfirmed", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "battleConfirmed",
        eventCode: 1133,
        eventCardUid: ehren!.uid,
        eventUids: [ehren!.uid, target!.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ehren!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "deck", position: "faceUpDefense", sequence: 0 },
      },
    ]);
  });
});

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (!session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyRestoredAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
