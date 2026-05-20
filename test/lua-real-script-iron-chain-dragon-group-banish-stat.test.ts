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
const ironChainDragonCode = "19974580";
const hasIronChainDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ironChainDragonCode}.lua`));
const fieldIronChainCode = "199745800";
const graveIronChainCode = "199745801";
const offSetCode = "199745802";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setIronChain = 0x25;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasIronChainDragonScript)("Lua real script Iron Chain Dragon group banish stat", () => {
  it("restores SpElim-filtered Iron Chain removal into operated-count ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ironChainDragonCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("return c:IsSetCard(SET_IRON_CHAIN) and c:IsMonster() and c:IsAbleToRemove() and aux.SpElimFilter(c,true)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.rfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.GetMatchingGroup(s.rfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,nil)");
    expect(script).toContain("local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(ct*200)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("Duel.DiscardDeck(1-tp,3,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ironChainDragonCode),
      { code: fieldIronChainCode, name: "Iron Chain Field Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setIronChain], level: 4, attack: 1500, defense: 1000 },
      { code: graveIronChainCode, name: "Iron Chain Grave Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setIronChain], level: 4, attack: 1200, defense: 1200 },
      { code: offSetCode, name: "Iron Chain Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19974580, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ironChainDragonCode, fieldIronChainCode, graveIronChainCode, offSetCode] }, 1: { main: [] } });
    startDuel(session);

    const dragon = requireCard(session, ironChainDragonCode);
    const fieldIronChain = requireCard(session, fieldIronChainCode);
    const graveIronChain = requireCard(session, graveIronChainCode);
    const decoy = requireCard(session, offSetCode);
    moveDuelCard(session.state, dragon.uid, "monsterZone", 0).position = "faceUpAttack";
    dragon.faceUp = true;
    moveDuelCard(session.state, fieldIronChain.uid, "monsterZone", 0).position = "faceUpAttack";
    fieldIronChain.faceUp = true;
    moveDuelCard(session.state, graveIronChain.uid, "graveyard", 0).position = "faceUpAttack";
    graveIronChain.faceUp = true;
    moveDuelCard(session.state, decoy.uid, "graveyard", 0).position = "faceUpAttack";
    decoy.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ironChainDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === dragon.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fieldIronChain.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === graveIronChain.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dragon.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === dragon.uid), restoredOpen.session.state)).toBe(2700);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === dragon.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, controller: 0, event: "continuous", range: ["monsterZone"], reset: { flags: 1107235328 }, sourceUid: dragon.uid, value: 200 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
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
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveIronChain.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragon.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
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
