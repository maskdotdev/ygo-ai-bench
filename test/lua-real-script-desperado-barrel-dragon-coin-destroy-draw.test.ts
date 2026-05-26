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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const desperadoCode = "76728962";
const targetACode = "767289620";
const targetBCode = "767289621";
const drawCode = "767289622";
const hasDesperadoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${desperadoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryDestroy = 0x1;
const categoryToHand = 0x8;
const categoryDraw = 0x10000;
const categorySearch = 0x20000;
const categorySpecialSummon = 0x200;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasDesperadoScript)("Lua real script Desperado Barrel Dragon coin destroy draw", () => {
  it("restores Battle Phase TossCoin heads into selected destruction, BreakEffect, and draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${desperadoCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = resolveDesperado({ reader, workspace });
    const desperado = requireCard(restored.session, desperadoCode);
    const targetA = requireCard(restored.session, targetACode);
    const targetB = requireCard(restored.session, targetBCode);
    const drawCard = requireCard(restored.session, drawCode);

    expect(restored.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(restored.session.state.cards.find((card) => card.uid === desperado.uid)).toMatchObject(destroyedCard(desperado.uid, desperado.uid));
    expect(restored.session.state.cards.find((card) => card.uid === targetA.uid)).toMatchObject(destroyedCard(targetA.uid, desperado.uid));
    expect(restored.session.state.cards.find((card) => card.uid === targetB.uid)).toMatchObject(destroyedCard(targetB.uid, desperado.uid));
    expect(restored.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(summarizeEvents(restored.session.state.eventHistory.filter((event) => ["coinTossed", "destroyed", "breakEffect", "cardsDrawn"].includes(event.eventName)))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventCardUid: undefined,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: desperado.uid,
        eventReasonEffectId: 2,
        eventUids: undefined,
        relatedEffectId: undefined,
      },
      destroyedEvent(desperado.uid, desperado.uid, undefined),
      destroyedEvent(targetA.uid, desperado.uid, undefined),
      destroyedEvent(targetB.uid, desperado.uid, undefined),
      destroyedEvent(desperado.uid, desperado.uid, [desperado.uid, targetA.uid, targetB.uid]),
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventCardUid: undefined,
        eventPlayer: undefined,
        eventValue: undefined,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: desperado.uid,
        eventReasonEffectId: 2,
        eventUids: undefined,
        relatedEffectId: undefined,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawCard.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: desperado.uid,
        eventReasonEffectId: 2,
        eventUids: [drawCard.uid],
        relatedEffectId: undefined,
      },
    ]);
  });
});

function resolveDesperado({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [desperadoCode, targetACode, targetBCode, drawCode] }, 1: { main: [] } });
  startDuel(session);
  const desperado = requireCard(session, desperadoCode);
  const targetA = requireCard(session, targetACode);
  const targetB = requireCard(session, targetBCode);
  moveFaceUpAttack(session, desperado.uid, 0, 0);
  moveFaceUpAttack(session, targetA.uid, 0, 1);
  moveFaceUpAttack(session, targetB.uid, 0, 2);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(desperadoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === desperado.uid).map((effect) => ({
    category: effect.category,
    code: effect.code,
    countLimit: effect.countLimit,
    event: effect.event,
    range: effect.range,
  }))).toEqual([
    { category: categorySpecialSummon, code: 1029, countLimit: undefined, event: "trigger", range: ["hand"] },
    { category: categoryDestroy | categoryCoin | categoryDraw, code: 1002, countLimit: 1, event: "quick", range: ["monsterZone"] },
    { category: categoryToHand | categorySearch, code: 1014, countLimit: undefined, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
  ]);
  const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === desperado.uid);
  expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, activation!);
  expect(restoredOpen.session.state.chain).toEqual([]);
  return restoredOpen;
}

function cards(): DuelCardData[] {
  return [
    { code: desperadoCode, name: "Desperado Barrel Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2800, defense: 2200 },
    { code: targetACode, name: "Desperado Target A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
    { code: targetBCode, name: "Desperado Target B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
    { code: drawCode, name: "Desperado Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Desperado Barrel Dragon");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_COIN+CATEGORY_DRAW)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
  expect(script).toContain("return Duel.IsBattlePhase()");
  expect(script).toContain("e:GetHandler():GetAttackAnnouncedCount()==0");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
  expect(script).toContain("local heads=Duel.CountHeads(Duel.TossCoin(tp,3))");
  expect(script).toContain("Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)");
  expect(script).toContain("local dg=g:Select(tp,1,ct,nil)");
  expect(script).toContain("Duel.HintSelection(dg)");
  expect(script).toContain("if Duel.Destroy(dg,REASON_EFFECT)>0 and heads==3 then");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId, sequence: number): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
  card.sequence = sequence;
}

function destroyedCard(uid: string, sourceUid: string) {
  return {
    uid,
    location: "graveyard",
    controller: 0,
    reason: duelReason.destroy | duelReason.effect,
    reasonPlayer: 0,
    reasonCardUid: sourceUid,
    reasonEffectId: 2,
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, eventUids: string[] | undefined) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventPlayer: undefined,
    eventValue: undefined,
    eventReason: duelReason.destroy | duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventUids,
    relatedEffectId: undefined,
  };
}

function summarizeEvents(events: DuelSession["state"]["eventHistory"]) {
  return events.map((event) => ({
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventUids: event.eventUids,
    relatedEffectId: event.relatedEffectId,
  }));
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
