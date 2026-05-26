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
const gamblerCode = "2196767";
const handACode = "21967670";
const handBCode = "21967671";
const opponentACode = "21967672";
const opponentBCode = "21967673";
const hasGamblerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gamblerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryDestroy = 0x1;
const categoryHandes = 0x80;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasGamblerScript)("Lua real script Gambler of Legend coin destroy hand discard", () => {
  it("restores TossCoin CountHeads destroy and CountTails hand discard branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gamblerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const heads = resolveGambler({ seed: 10, reader, workspace });
    const headsGambler = requireCard(heads.session, gamblerCode);
    const opponentA = requireCard(heads.session, opponentACode);
    const opponentB = requireCard(heads.session, opponentBCode);
    expect(heads.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(heads.session.state.cards.find((card) => card.uid === headsGambler.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(heads.session.state.cards.find((card) => card.uid === opponentA.uid)).toMatchObject(destroyedCard(opponentA.uid, headsGambler.uid, 1));
    expect(heads.session.state.cards.find((card) => card.uid === opponentB.uid)).toMatchObject(destroyedCard(opponentB.uid, headsGambler.uid, 1));
    expect(summarizeEvents(heads.session.state.eventHistory.filter((event) => event.eventName === "coinTossed" || event.eventName === "destroyed"))).toEqual([
      coinEvent(headsGambler.uid, 3),
      destroyedEvent(opponentA.uid, headsGambler.uid, undefined),
      destroyedEvent(opponentB.uid, headsGambler.uid, undefined),
      destroyedEvent(opponentA.uid, headsGambler.uid, [opponentA.uid, opponentB.uid]),
    ]);

    const tails = resolveGambler({ seed: 1, reader, workspace });
    const tailsGambler = requireCard(tails.session, gamblerCode);
    const handA = requireCard(tails.session, handACode);
    const handB = requireCard(tails.session, handBCode);
    expect(tails.session.state.lastCoinResults).toEqual([0, 0, 0]);
    expect(tails.session.state.cards.find((card) => card.uid === tailsGambler.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(tails.session.state.cards.find((card) => card.uid === handA.uid)).toMatchObject(discardedCard(handA.uid, tailsGambler.uid));
    expect(tails.session.state.cards.find((card) => card.uid === handB.uid)).toMatchObject(discardedCard(handB.uid, tailsGambler.uid));
    expect(summarizeEvents(tails.session.state.eventHistory.filter((event) => event.eventName === "coinTossed" || event.eventName === "discarded"))).toEqual([
      coinEvent(tailsGambler.uid, 3),
      discardedEvent(handA.uid, tailsGambler.uid, undefined),
      discardedEvent(handB.uid, tailsGambler.uid, undefined),
    ]);
  });
});

function resolveGambler({
  seed,
  reader,
  workspace,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gamblerCode, handACode, handBCode] }, 1: { main: [opponentACode, opponentBCode] } });
  startDuel(session);
  const gambler = requireCard(session, gamblerCode);
  const handA = requireCard(session, handACode);
  const handB = requireCard(session, handBCode);
  const opponentA = requireCard(session, opponentACode);
  const opponentB = requireCard(session, opponentBCode);
  moveFaceUpAttack(session, gambler.uid, 0, 0);
  moveDuelCard(session.state, handA.uid, "hand", 0);
  moveDuelCard(session.state, handB.uid, "hand", 0);
  moveFaceUpAttack(session, opponentA.uid, 1, 0);
  moveFaceUpAttack(session, opponentB.uid, 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gamblerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gambler.uid).map((effect) => ({
    category: effect.category,
    code: effect.code,
    countLimit: effect.countLimit,
    event: effect.event,
    range: effect.range,
  }))).toEqual([
    { category: categoryDestroy | categoryHandes | categoryCoin, code: undefined, countLimit: 1, event: "ignition", range: ["monsterZone"] },
  ]);
  const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gambler.uid);
  expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, activation!);
  expect(restoredOpen.session.state.chain).toEqual([]);
  return restoredOpen;
}

function cards(): DuelCardData[] {
  return [
    { code: gamblerCode, name: "Gambler of Legend", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 500, defense: 1400 },
    { code: handACode, name: "Gambler Hand A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: handBCode, name: "Gambler Hand B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
    { code: opponentACode, name: "Gambler Opponent A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    { code: opponentBCode, name: "Gambler Opponent B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gambler of Legend");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_HANDES+CATEGORY_COIN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("local c1,c2,c3=Duel.TossCoin(tp,3)");
  expect(script).toContain("local total_heads=Duel.CountHeads(c1,c2,c3)");
  expect(script).toContain("Duel.GetMatchingGroup(nil,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_HAND):RandomSelect(tp,1)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.CountTails(c1,c2,c3)==3");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_HAND,0)");
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

function destroyedCard(uid: string, sourceUid: string, controller: PlayerId) {
  return { uid, location: "graveyard", controller, reason: duelReason.destroy | duelReason.effect, reasonPlayer: 0, reasonCardUid: sourceUid, reasonEffectId: 1 };
}

function discardedCard(uid: string, sourceUid: string) {
  return { uid, location: "graveyard", controller: 0, reason: duelReason.discard | duelReason.effect, reasonPlayer: 0, reasonCardUid: sourceUid, reasonEffectId: 1 };
}

function coinEvent(sourceUid: string, value: number) {
  return {
    eventName: "coinTossed",
    eventCode: 1151,
    eventCardUid: undefined,
    eventPlayer: 0,
    eventValue: value,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventUids: undefined,
    relatedEffectId: undefined,
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
    eventReasonEffectId: 1,
    eventUids,
    relatedEffectId: undefined,
  };
}

function discardedEvent(cardUid: string, sourceUid: string, eventUids: string[] | undefined) {
  return {
    eventName: "discarded",
    eventCode: 1018,
    eventCardUid: cardUid,
    eventPlayer: undefined,
    eventValue: undefined,
    eventReason: duelReason.discard | duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
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
