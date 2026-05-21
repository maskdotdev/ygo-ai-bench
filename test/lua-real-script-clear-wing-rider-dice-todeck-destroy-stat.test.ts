import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const riderCode = "86154370";
const graveWindCode = "861543700";
const opponentACode = "861543701";
const opponentBCode = "861543702";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasRiderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${riderCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRiderScript)("Lua real script Clear Wing Rider dice to-Deck destroy stat", () => {
  it("restores dice-selected WIND Graveyard shuffle into optional destruction and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${riderCode}.lua`);
    expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WIND),1,1,Synchro.NonTunerEx(s.matfilter),1,1)");
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,1)");
    expect(script).toContain("local d=Duel.TossDice(tp,1)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.tdfilter),tp,LOCATION_GRAVE,0,1,d,nil)");
    expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,0,LOCATION_ONFIELD,1,dc,nil)");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(oc*500)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === riderCode),
      { code: graveWindCode, name: "Clear Wing Rider WIND Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeWind, attack: 1000, defense: 1000 },
      { code: opponentACode, name: "Clear Wing Rider Destroy Target A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
      { code: opponentBCode, name: "Clear Wing Rider Destroy Target B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 86154370, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [graveWindCode], extra: [riderCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const rider = requireCard(session, riderCode);
    const graveWind = requireCard(session, graveWindCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    moveFaceUpAttack(session, rider, 0);
    rider.summonType = "synchro";
    moveDuelCard(session.state, graveWind.uid, "graveyard", 0);
    moveFaceUpAttack(session, opponentA, 1);
    moveFaceUpAttack(session, opponentB, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(riderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === rider.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.randomCounter).toBe(2);
    expect(restoredResolved.session.state.lastDiceResults).toHaveLength(1);
    expect(restoredResolved.host.promptDecisions).toEqual([]);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === graveWind.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: rider.uid,
      reasonEffectId: 2,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === opponentA.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: rider.uid,
      reasonEffectId: 2,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === opponentB.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === rider.uid), restoredResolved.session.state)).toBe((rider.data.attack ?? 0) + 500);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === rider.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107235328 }, value: 500 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["diceTossed", "sentToDeck", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "diceTossed",
        eventCardUid: undefined,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: rider.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "sentToDeck",
        eventCardUid: graveWind.uid,
        eventPlayer: undefined,
        eventValue: undefined,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: rider.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "destroyed",
        eventCardUid: opponentA.uid,
        eventPlayer: undefined,
        eventValue: undefined,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: rider.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
