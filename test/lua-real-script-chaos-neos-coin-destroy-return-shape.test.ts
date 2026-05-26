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
const chaosNeosCode = "17032740";
const opponentACode = "170327400";
const opponentBCode = "170327401";
const ownReturnCode = "170327402";
const hasChaosNeosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chaosNeosCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const categoryDestroy = 0x1;
const categoryToHand = 0x8;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasChaosNeosScript)("Lua real script Elemental HERO Chaos Neos coin destroy return shape", () => {
  it("restores main-phase three-head TossCoin into opponent monster destruction and pins return/contact shape", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chaosNeosCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = resolveChaosNeos({ reader, workspace });
    const chaosNeos = requireCard(restored.session, chaosNeosCode);
    const opponentA = requireCard(restored.session, opponentACode);
    const opponentB = requireCard(restored.session, opponentBCode);

    expect(restored.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(restored.session.state.cards.find((card) => card.uid === chaosNeos.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentA.uid)).toMatchObject(destroyedCard(opponentA.uid, chaosNeos.uid));
    expect(restored.session.state.cards.find((card) => card.uid === opponentB.uid)).toMatchObject(destroyedCard(opponentB.uid, chaosNeos.uid));
    expect(summarizeEvents(restored.session.state.eventHistory.filter((event) => event.eventName === "coinTossed" || event.eventName === "destroyed"))).toEqual([
      coinEvent(chaosNeos.uid),
      destroyedEvent(opponentA.uid, chaosNeos.uid, undefined),
      destroyedEvent(opponentB.uid, chaosNeos.uid, undefined),
      destroyedEvent(opponentA.uid, chaosNeos.uid, [opponentA.uid, opponentB.uid]),
    ]);
  });
});

function resolveChaosNeos({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { extra: [chaosNeosCode], main: [ownReturnCode] }, 1: { main: [opponentACode, opponentBCode] } });
  startDuel(session);
  const chaosNeos = requireCard(session, chaosNeosCode);
  const opponentA = requireCard(session, opponentACode);
  const opponentB = requireCard(session, opponentBCode);
  moveFaceUpAttack(session, chaosNeos.uid, 0, 0);
  moveFaceUpAttack(session, opponentA.uid, 1, 0);
  moveFaceUpAttack(session, opponentB.uid, 1, 1);
  moveFaceUpAttack(session, requireCard(session, ownReturnCode).uid, 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(chaosNeosCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === chaosNeos.uid && effect.event === "ignition").map((effect) => ({
    category: effect.category,
    code: effect.code,
    countLimit: effect.countLimit,
    range: effect.range,
  }))).toEqual([
    { category: categoryCoin | categoryDestroy | categoryToHand, code: undefined, countLimit: 1, range: ["monsterZone"] },
  ]);

  const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === chaosNeos.uid);
  expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, activation!);
  expect(restoredOpen.session.state.chain).toEqual([]);
  return restoredOpen;
}

function cards(): DuelCardData[] {
  return [
    { code: chaosNeosCode, name: "Elemental HERO Chaos Neos", kind: "monster", typeFlags: typeMonster | typeEffect | typeFusion, level: 9, attack: 3000, defense: 2500 },
    { code: opponentACode, name: "Chaos Neos Opponent A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    { code: opponentBCode, name: "Chaos Neos Opponent B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000 },
    { code: ownReturnCode, name: "Chaos Neos Return Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Elemental HERO Chaos Neos");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,CARD_NEOS,43237273,17732278)");
  expect(script).toContain("Fusion.AddContactProc(c,s.contactfil,s.contactop,s.splimit)");
  expect(script).toContain("aux.EnableNeosReturn(c,CATEGORY_POSITION+CATEGORY_SET,s.retinfo,s.retop)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_COST|REASON_MATERIAL)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,nil,1,PLAYER_ALL,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ChangePosition(g,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_DESTROY+CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("return Duel.IsPhase(PHASE_MAIN1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("local total_heads=Duel.CountHeads(Duel.TossCoin(tp,3))");
  expect(script).toContain("if total_heads==3 then");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_MZONE)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("elseif total_heads==2 then");
  expect(script).toContain("tc:RegisterEffect(e1)");
  expect(script).toContain("tc:RegisterEffect(e2)");
  expect(script).toContain("elseif total_heads==1 then");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsAbleToHand,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
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
  return { uid, location: "graveyard", controller: 1, reason: duelReason.destroy | duelReason.effect, reasonPlayer: 0, reasonCardUid: sourceUid, reasonEffectId: 5 };
}

function coinEvent(sourceUid: string) {
  return {
    eventName: "coinTossed",
    eventCode: 1151,
    eventCardUid: undefined,
    eventPlayer: 0,
    eventValue: 3,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 5,
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
    eventReasonEffectId: 5,
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
