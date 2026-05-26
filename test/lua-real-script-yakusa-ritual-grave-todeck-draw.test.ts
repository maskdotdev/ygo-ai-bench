import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const yakusaCode = "90583279";
const ritualTargetCode = "905832790";
const drawCode = "905832791";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasYakusaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${yakusaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceThunder = 0x1000000;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasYakusaScript)("Lua real script Yakusa ritual grave to-Deck draw", () => {
  it("restores targeted Level 8 Ritual return to Deck into BreakEffect draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${yakusaCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yakusaCode),
      { code: ritualTargetCode, name: "Yakusa Ritual Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceThunder, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
      { code: drawCode, name: "Yakusa Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 90583279, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yakusaCode, ritualTargetCode, drawCode] }, 1: { main: [] } });
    startDuel(session);

    const yakusa = requireCard(session, yakusaCode);
    const ritualTarget = requireCard(session, ritualTargetCode);
    const drawCard = requireCard(session, drawCode);
    const fieldYakusa = moveDuelCard(session.state, yakusa.uid, "monsterZone", 0);
    fieldYakusa.faceUp = true;
    fieldYakusa.position = "faceUpAttack";
    moveDuelCard(session.state, ritualTarget.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yakusaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === yakusa.uid && candidate.effectId === "lua-2");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(action).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ritualTarget.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: yakusa.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToDeck", "breakEffect", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: ritualTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: ritualTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: yakusa.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: yakusa.uid,
        eventReasonEffectId: 2,
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
        eventReasonCardUid: yakusa.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.GetMZoneCount(tp,c)>0");
  expect(script).toContain("aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,true,nil,tp)");
  expect(script).toContain("Duel.Remove(rg,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TODECK+CATEGORY_DRAW+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_GRAVE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,tc,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("Duel.ShuffleDeck(tp)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

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
