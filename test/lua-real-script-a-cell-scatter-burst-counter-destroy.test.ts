import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const scatterBurstCode = "73262676";
const alienTargetCode = "732626760";
const opponentCounterTargetCode = "732626761";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasScatterBurstScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${scatterBurstCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const attributeDark = 0x20;
const setAlien = 0xc;
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasScatterBurstScript)("Lua real script A Cell Scatter Burst counter destroy", () => {
  it("restores own Alien target destruction into repeated opponent A-Counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${scatterBurstCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 73262676, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scatterBurstCode, alienTargetCode] }, 1: { main: [opponentCounterTargetCode] } });
    startDuel(session);

    const scatterBurst = requireCard(session, scatterBurstCode);
    const alienTarget = requireCard(session, alienTargetCode);
    const opponentCounterTarget = requireCard(session, opponentCounterTargetCode);
    moveDuelCard(session.state, scatterBurst.uid, "hand", 0);
    moveFaceUpAttack(session, alienTarget, 0, 0);
    moveFaceUpAttack(session, opponentCounterTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(scatterBurstCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === scatterBurst.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, alienTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: scatterBurst.uid,
      reasonEffectId: 1,
    });
    expect(getDuelCardCounter(findCard(restored.session, opponentCounterTarget.uid), counterA)).toBe(3);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "counterAdded", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: alienTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: alienTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: scatterBurst.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: alienTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: scatterBurst.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentCounterTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: scatterBurst.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentCounterTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: scatterBurst.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentCounterTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: scatterBurst.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: scatterBurst.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(getDuelCardCounter(findCard(restoredResolved.session, opponentCounterTarget.uid), counterA)).toBe(3);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const scatterBurst = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === scatterBurstCode);
  expect(scatterBurst).toBeDefined();
  return [
    scatterBurst!,
    { code: alienTargetCode, name: "A Cell Scatter Burst Alien Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, setcodes: [setAlien], level: 3, attack: 1200, defense: 1000 },
    { code: opponentCounterTargetCode, name: "A Cell Scatter Burst Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("\"A\" Cell Scatter Burst");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_ALIEN) and c:HasLevel()");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("local lv=tc:GetLevel()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("sg:GetFirst():AddCounter(COUNTER_A,1)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
