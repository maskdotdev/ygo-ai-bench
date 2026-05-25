import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const gambleCode = "37313786";
const hasGambleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gambleCode}.lua`));
const drawCodes = ["373137860", "373137861", "373137862", "373137863", "373137864"];
const opponentHandCodes = ["373137865", "373137866", "373137867", "373137868", "373137869", "373137870"];
const typeMonster = 0x1;
const typeTrap = 0x4;
const categoryCoin = 0x1000000;
const categoryDraw = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasGambleScript)("Lua real script Gamble CallCoin draw", () => {
  it("restores its hand-size-gated Trap activation into the successful called-coin draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gambleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gambleCode, ...drawCodes] }, 1: { main: opponentHandCodes } });
    startDuel(session);

    const gamble = requireCard(session, gambleCode);
    const drawCards = drawCodes.map((code) => requireCard(session, code));
    const opponentHand = opponentHandCodes.map((code) => requireCard(session, code));
    const setGamble = moveDuelCard(session.state, gamble.uid, "spellTrapZone", 0);
    setGamble.sequence = 0;
    setGamble.faceUp = false;
    setGamble.position = "faceDown";
    opponentHand.forEach((card, index) => {
      const moved = moveDuelCard(session.state, card.uid, "hand", 1);
      moved.sequence = index;
    });
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gambleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gamble.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
    }))).toEqual([
      { category: categoryCoin | categoryDraw, code: 1002, countLimit: undefined, event: "quick" },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gamble.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === gamble.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    for (const card of drawCards) {
      expect(restoredOpen.session.state.cards.find((candidate) => candidate.uid === card.uid)).toMatchObject({
        location: "hand",
        controller: 0,
        reasonPlayer: 0,
      });
    }
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gamble.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawCards[1]!.uid,
        eventPlayer: 0,
        eventValue: 5,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gamble.uid,
        eventReasonEffectId: 1,
        eventUids: [drawCards[1]!.uid, drawCards[4]!.uid, drawCards[3]!.uid, drawCards[2]!.uid, drawCards[0]!.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gamble");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_DRAW)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)<=2");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>=6");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("if Duel.CallCoin(tp) then");
  expect(script).toContain("Duel.Draw(tp,5-gc,REASON_EFFECT)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetCode(EFFECT_SKIP_TURN)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: gambleCode, name: "Gamble", kind: "trap", typeFlags: typeTrap },
    ...drawCodes.map((code, index) => ({ code, name: `Gamble Draw ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1000 + index, defense: 1000 })),
    ...opponentHandCodes.map((code, index) => ({ code, name: `Gamble Opponent Hand ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1500 + index, defense: 1000 })),
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
