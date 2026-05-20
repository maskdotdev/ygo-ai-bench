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
const rechargeCode = "33725271";
const hasRechargeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rechargeCode}.lua`));
const volcanicOneCode = "33725272";
const volcanicTwoCode = "33725273";
const offSetMonsterCode = "33725274";
const volcanicSpellCode = "33725275";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const racePyro = 0x80;
const attributeFire = 0x4;
const setVolcanic = 0x32;

describe.skipIf(!hasUpstreamScripts || !hasRechargeScript)("Lua real script Volcanic Recharge grave shuffle", () => {
  it("restores free-chain Graveyard Volcanic monster targets and shuffles only valid cards into the Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${rechargeCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsSetCard(SET_VOLCANIC) and c:IsMonster() and c:IsAbleToDeck()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,3,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,g,#g,0,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("Duel.SendtoDeck(sg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: rechargeCode, name: "Volcanic Recharge", kind: "spell", typeFlags: typeSpell },
      { code: volcanicOneCode, name: "Volcanic Grave Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1200, defense: 1000, setcodes: [setVolcanic] },
      { code: volcanicTwoCode, name: "Volcanic Grave Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1400, defense: 1000, setcodes: [setVolcanic] },
      { code: offSetMonsterCode, name: "Off-Set Graveyard Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1600, defense: 1000, setcodes: [0x123] },
      { code: volcanicSpellCode, name: "Volcanic Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setVolcanic] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 33725271, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rechargeCode, volcanicOneCode, volcanicTwoCode, offSetMonsterCode, volcanicSpellCode] }, 1: { main: [] } });
    startDuel(session);

    const recharge = requireCard(session, rechargeCode);
    const volcanicOne = requireCard(session, volcanicOneCode);
    const volcanicTwo = requireCard(session, volcanicTwoCode);
    const offSetMonster = requireCard(session, offSetMonsterCode);
    const volcanicSpell = requireCard(session, volcanicSpellCode);
    const rechargeOnField = moveDuelCard(session.state, recharge.uid, "spellTrapZone", 0);
    rechargeOnField.position = "faceDown";
    rechargeOnField.faceUp = false;
    moveDuelCard(session.state, volcanicOne.uid, "graveyard", 0);
    moveDuelCard(session.state, volcanicTwo.uid, "graveyard", 0);
    moveDuelCard(session.state, offSetMonster.uid, "graveyard", 0);
    moveDuelCard(session.state, volcanicSpell.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rechargeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const activate = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === recharge.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, activate!);
    expect(restoredOpenWindow.session.state.chain).toEqual([
    ]);
    expect(restoredOpenWindow.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpenWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck")).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: volcanicOne.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recharge.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: volcanicTwo.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 1 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recharge.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: volcanicOne.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recharge.uid,
        eventReasonEffectId: 1,
        eventUids: [volcanicOne.uid, volcanicTwo.uid],
      },
    ]);
    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === recharge.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
    });
    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === volcanicOne.uid)).toMatchObject({ location: "deck", controller: 0, reason: duelReason.effect });
    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === volcanicTwo.uid)).toMatchObject({ location: "deck", controller: 0, reason: duelReason.effect });
    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === offSetMonster.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === volcanicSpell.uid)).toMatchObject({ location: "graveyard", controller: 0 });

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
