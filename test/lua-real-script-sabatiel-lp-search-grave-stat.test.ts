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
const sabatielCode = "80831721";
const wingedKuribohCode = "57116033";
const polymerizationCode = "24094653";
const ownTargetCode = "808317210";
const ownHighCode = "808317211";
const opponentHighCode = "808317212";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSabatielScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sabatielCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFairy = 0x4;
const attributeLight = 0x10;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSabatielScript)("Lua real script Sabatiel LP search grave stat", () => {
  it("restores half-LP Fusion Spell search and three-copy grave ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sabatielCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const searchSession = createDuel({ seed: 80831721, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(searchSession, { 0: { main: [sabatielCode, wingedKuribohCode, polymerizationCode] }, 1: { main: [] } });
    startDuel(searchSession);
    const searchSabatiel = requireCard(searchSession, sabatielCode);
    const wingedKuriboh = requireCard(searchSession, wingedKuribohCode);
    const polymerization = requireCard(searchSession, polymerizationCode);
    moveDuelCard(searchSession.state, searchSabatiel.uid, "hand", 0);
    moveDuelCard(searchSession.state, wingedKuriboh.uid, "graveyard", 0).faceUp = true;
    searchSession.state.phase = "main1";
    searchSession.state.turnPlayer = 0;
    searchSession.state.waitingFor = 0;
    const searchHost = createLuaScriptHost(searchSession, workspace);
    expect(searchHost.loadCardScript(Number(sabatielCode), workspace).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchActivation = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateEffect" && action.uid === searchSabatiel.uid
    );
    expect(searchActivation, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchActivation!);
    expect(restoredSearch.session.state.players[0].lifePoints).toBe(4000);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredSearch.session), workspace, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    resolveRestoredChain(restoredSearchChain);
    expect(findCard(restoredSearchChain.session, polymerization.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchSabatiel.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) =>
      ["lifePointCostPaid", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: undefined, eventCode: 1201, eventName: "lifePointCostPaid", eventPlayer: 0, eventReason: duelReason.cost, eventReasonCardUid: searchSabatiel.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: 4000 },
      { eventCardUid: polymerization.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: searchSabatiel.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: undefined },
      { eventCardUid: polymerization.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchSabatiel.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: 1 },
      { eventCardUid: polymerization.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchSabatiel.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, eventValue: 1 },
    ]);

    const statSession = createDuel({ seed: 80831722, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [sabatielCode, sabatielCode, sabatielCode, ownTargetCode, ownHighCode] }, 1: { main: [opponentHighCode] } });
    startDuel(statSession);
    const statSabatiels = statSession.state.cards.filter((card) => card.code === sabatielCode);
    expect(statSabatiels).toHaveLength(3);
    const ownTarget = requireCard(statSession, ownTargetCode);
    const ownHigh = requireCard(statSession, ownHighCode);
    const opponentHigh = requireCard(statSession, opponentHighCode);
    for (const sabatiel of statSabatiels) moveDuelCard(statSession.state, sabatiel.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(statSession, ownTarget, 0, 0);
    moveFaceUpAttack(statSession, ownHigh, 0, 1);
    moveFaceUpAttack(statSession, opponentHigh, 1, 0);
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(sabatielCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(3);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statActivation = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statSabatiels[0]?.uid
    );
    expect(statActivation, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    if (!statActivation || statActivation.type !== "activateEffect") throw new Error("Missing Sabatiel grave activation");
    const statEffectId = Number(statActivation.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredStat, statActivation);

    const restoredStatChain = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredStatChain);
    expectRestoredLegalActions(restoredStatChain, 1);
    resolveRestoredChain(restoredStatChain);
    expect(statSabatiels.map((sabatiel) => findCard(restoredStatChain.session, sabatiel.uid)).map((sabatiel) => ({
      controller: sabatiel.controller,
      faceUp: sabatiel.faceUp,
      location: sabatiel.location,
      reason: sabatiel.reason,
      reasonCardUid: sabatiel.reasonCardUid,
      reasonEffectId: sabatiel.reasonEffectId,
      reasonPlayer: sabatiel.reasonPlayer,
    }))).toEqual([
      { controller: 0, faceUp: true, location: "banished", reason: duelReason.effect, reasonCardUid: statSabatiels[0]?.uid, reasonEffectId: statEffectId, reasonPlayer: 0 },
      { controller: 0, faceUp: true, location: "banished", reason: duelReason.effect, reasonCardUid: statSabatiels[0]?.uid, reasonEffectId: statEffectId, reasonPlayer: 0 },
      { controller: 0, faceUp: true, location: "banished", reason: duelReason.effect, reasonCardUid: statSabatiels[0]?.uid, reasonEffectId: statEffectId, reasonPlayer: 0 },
    ]);
    expect(currentAttack(findCard(restoredStatChain.session, ownTarget.uid), restoredStatChain.session.state)).toBe(3300);
    expect(restoredStatChain.session.state.effects.filter((effect) =>
      effect.sourceUid === ownTarget.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: ownTarget.uid, value: 2300 },
    ]);
    expect(restoredStatChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Sabatiel - The Philosopher's Stone");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsSetCard,tp,LOCATION_GRAVE,0,1,nil,SET_WINGED_KURIBOH)");
  expect(script).toContain("Duel.PayLPCost(tp,math.floor(Duel.GetLP(tp)/2))");
  expect(script).toContain("return c:IsSetCard(SET_FUSION) and c:IsSpell() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rfilter,tp,LOCATION_GRAVE,0,3,3,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("local mg,matk=og:GetMaxGroup(Card.GetAttack)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const official = workspace.readDatabaseCards("cards.cdb").filter((card) =>
    [sabatielCode, wingedKuribohCode, polymerizationCode].includes(card.code)
  );
  expect(official.map((card) => card.code).sort()).toEqual([polymerizationCode, sabatielCode, wingedKuribohCode].sort());
  return [
    ...official,
    { code: ownTargetCode, name: "Sabatiel Boost Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: ownHighCode, name: "Sabatiel Own High ATK", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1900, defense: 1000 },
    { code: opponentHighCode, name: "Sabatiel Opponent High ATK", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 2300, defense: 1000 },
  ];
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
  const waitingFor = response.state.waitingFor;
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
