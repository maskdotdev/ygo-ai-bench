import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
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
const raidenCode = "77558536";
const hasRaidenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${raidenCode}.lua`));
const milledLightswornCode = "775585360";
const milledDecoyCode = "775585361";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setLightsworn = 0x38;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRaidenScript)("Lua real script Raiden operated mill stat", () => {
  it("restores operated Deck mill filtering into delayed ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${raidenCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DECKDES)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,2)");
    expect(script).toContain("Duel.DiscardDeck(tp,2,REASON_EFFECT)");
    expect(script).toContain("local g=Duel.GetOperatedGroup()");
    expect(script).toContain("local ct=g:FilterCount(s.cfilter,nil)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(200)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("return tp==Duel.GetTurnPlayer()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === raidenCode),
      { code: milledLightswornCode, name: "Raiden Milled Lightsworn", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLightsworn], level: 4, attack: 1500, defense: 1000 },
      { code: milledDecoyCode, name: "Raiden Milled Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 1700, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 77558536, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [raidenCode, milledDecoyCode, milledLightswornCode] }, 1: { main: [] } });
    startDuel(session);

    const raiden = requireCard(session, raidenCode);
    const milledLightsworn = requireCard(session, milledLightswornCode);
    const milledDecoy = requireCard(session, milledDecoyCode);
    moveDuelCard(session.state, raiden.uid, "monsterZone", 0).position = "faceUpAttack";
    raiden.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(raidenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === raiden.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === milledDecoy.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: raiden.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === milledLightsworn.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: raiden.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === raiden.uid), restoredOpen.session.state)).toBe(1900);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === raiden.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, controller: 0, event: "continuous", range: ["monsterZone"], reset: { count: 2, flags: 1107235328 }, sourceUid: raiden.uid, value: 200 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventPreviousState: event.eventPreviousState,
      eventCurrentState: event.eventCurrentState,
    }))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: milledLightsworn.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: raiden.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: milledDecoy.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: raiden.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: milledLightsworn.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: raiden.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "breakEffect")).toEqual([
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: raiden.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
