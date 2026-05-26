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
const daibakCode = "93368494";
const opponentTargetCode = "933684940";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDaibakScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${daibakCode}.lua`));
const setYosenju = 0xb3;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeast = 0x4000;
const attributeWind = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasDaibakScript)("Lua real script Mayosenju Daibak summon to hand", () => {
  it("restores summon target selection through GetTargetCards into one-field-card hand return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${daibakCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = createRestoredSummonOpen(workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const daibak = requireCard(restored.session, daibakCode);
    const target = requireCard(restored.session, opponentTargetCode);
    const normalSummon = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "normalSummon" && action.uid === daibak.uid
    );
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, normalSummon!);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === daibak.uid && action.effectId === "lua-6-1100"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, trigger!);
    expect(restored.session.state.chain.map((link) => link.operationInfos)).toEqual([]);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: daibak.uid,
      reasonEffectId: 6,
    });
    expect(restored.session.state.cards.find((card) => card.uid === daibak.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: daibak.uid,
      reasonEffectId: 6,
    });
    expect(restored.session.state.eventHistory.filter((event) =>
      ["normalSummoned", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventChainLinkId: event.eventChainLinkId,
      eventCode: event.eventCode,
      eventCurrentLocation: event.eventCurrentState?.location,
      eventName: event.eventName,
      eventPreviousLocation: event.eventPreviousState?.location,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      {
        eventCardUid: daibak.uid,
        eventChainLinkId: undefined,
        eventCode: 1100,
        eventCurrentLocation: "monsterZone",
        eventName: "normalSummoned",
        eventPreviousLocation: "hand",
        eventReason: duelReason.summon,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventReasonPlayer: 0,
        eventUids: undefined,
        relatedEffectId: undefined,
      },
      {
        eventCardUid: daibak.uid,
        eventChainLinkId: "chain-3",
        eventCode: 1028,
        eventCurrentLocation: "monsterZone",
        eventName: "becameTarget",
        eventPreviousLocation: "hand",
        eventReason: duelReason.summon,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventReasonPlayer: 0,
        eventUids: undefined,
        relatedEffectId: 6,
      },
      {
        eventCardUid: target.uid,
        eventChainLinkId: "chain-3",
        eventCode: 1028,
        eventCurrentLocation: "monsterZone",
        eventName: "becameTarget",
        eventPreviousLocation: "deck",
        eventReason: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventReasonPlayer: 0,
        eventUids: undefined,
        relatedEffectId: 6,
      },
      {
        eventCardUid: daibak.uid,
        eventChainLinkId: undefined,
        eventCode: 1012,
        eventCurrentLocation: "hand",
        eventName: "sentToHand",
        eventPreviousLocation: "monsterZone",
        eventReason: duelReason.effect,
        eventReasonCardUid: daibak.uid,
        eventReasonEffectId: 6,
        eventReasonPlayer: 0,
        eventUids: undefined,
        relatedEffectId: undefined,
      },
      {
        eventCardUid: target.uid,
        eventChainLinkId: undefined,
        eventCode: 1012,
        eventCurrentLocation: "hand",
        eventName: "sentToHand",
        eventPreviousLocation: "monsterZone",
        eventReason: duelReason.effect,
        eventReasonCardUid: daibak.uid,
        eventReasonEffectId: 6,
        eventReasonPlayer: 0,
        eventUids: undefined,
        relatedEffectId: undefined,
      },
      {
        eventCardUid: daibak.uid,
        eventChainLinkId: undefined,
        eventCode: 1012,
        eventCurrentLocation: "hand",
        eventName: "sentToHand",
        eventPreviousLocation: "monsterZone",
        eventReason: duelReason.effect,
        eventReasonCardUid: daibak.uid,
        eventReasonEffectId: 6,
        eventReasonPlayer: 0,
        eventUids: [daibak.uid, target.uid],
        relatedEffectId: undefined,
      },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: daibakCode, name: "Mayosenju Daibak", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeWind, setcodes: [setYosenju], level: 4, attack: 3000, defense: 300, leftScale: 7, rightScale: 7 },
    { code: opponentTargetCode, name: "Mayosenju Daibak Return Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
  ];
}

function createRestoredSummonOpen(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 93368494, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [daibakCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  const daibak = requireCard(session, daibakCode);
  const target = requireCard(session, opponentTargetCode);
  moveDuelCard(session.state, daibak.uid, "hand", 0);
  moveFaceUpMonster(session, target, 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(daibakCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mayosenju Daibak");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e5:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e5:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e5:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e6:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,2,nil)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("e7:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("ge1:SetOperation(aux.sumreg)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
