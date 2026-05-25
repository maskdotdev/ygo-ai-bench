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
const cupOfAceCode = "37812118";
const hasCupOfAceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cupOfAceCode}.lua`));
const drawCodes = ["378121180", "378121181"];
const typeMonster = 0x1;
const typeSpell = 0x2;
const categoryCoin = 0x1000000;
const categoryDraw = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasCupOfAceScript)("Lua real script Cup of Ace TossCoin draw", () => {
  it("restores its Spell activation into a heads toss that draws two cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cupOfAceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cupOfAceCode, ...drawCodes] }, 1: { main: [] } });
    startDuel(session);

    const cupOfAce = requireCard(session, cupOfAceCode);
    const drawCards = drawCodes.map((code) => requireCard(session, code));
    const setSpell = moveDuelCard(session.state, cupOfAce.uid, "spellTrapZone", 0);
    setSpell.sequence = 0;
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cupOfAceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === cupOfAce.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
    }))).toEqual([
      { category: categoryCoin | categoryDraw, code: 1002, countLimit: undefined, event: "ignition" },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === cupOfAce.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cupOfAce.uid)).toMatchObject({
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
        eventReasonCardUid: cupOfAce.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawCards[1]!.uid,
        eventPlayer: 0,
        eventValue: 2,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cupOfAce.uid,
        eventReasonEffectId: 1,
        eventUids: [drawCards[1]!.uid, drawCards[0]!.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cup of Ace");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_DRAW)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.IsPlayerCanDraw(tp,2) or Duel.IsPlayerCanDraw(1-tp,2)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_EITHER,2)");
  expect(script).toContain("local coin=Duel.TossCoin(tp,1)");
  expect(script).toContain("local player=(coin==COIN_HEADS and tp) or (coin==COIN_TAILS and 1-tp) or nil");
  expect(script).toContain("Duel.Draw(player,2,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: cupOfAceCode, name: "Cup of Ace", kind: "spell", typeFlags: typeSpell },
    ...drawCodes.map((code, index) => ({ code, name: `Cup of Ace Draw ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1000 + index, defense: 1000 })),
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
