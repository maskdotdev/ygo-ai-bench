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
const majesticCode = "67030233";
const redDragonCode = "70902743";
const targetCode = "670302330";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMajesticScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${majesticCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMajesticScript)("Lua real script Majestic Red Dragon disable return stat", () => {
  it("restores targeted disable AdjustInstantly ATK gain and End Phase Extra Deck return revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${majesticCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const majestic = requireCard(session, majesticCode);
    const redDragon = requireCard(session, redDragonCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, majestic, 0);
    majestic.summonType = "synchro";
    majestic.customStatusMask = 0x8;
    moveDuelCard(session.state, redDragon.uid, "graveyard", 0);
    redDragon.faceUp = true;
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(majesticCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const negate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === majestic.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, negate!);
    resolveRestoredChain(restoredOpen);

    const restoredNegated = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredNegated);
    expectRestoredLegalActions(restoredNegated, 0);
    expect(currentAttack(restoredNegated.session.state.cards.find((card) => card.uid === majestic.uid), restoredNegated.session.state)).toBe(7200);
    expect(restoredNegated.session.state.effects.filter((effect) => [2, 8].includes(effect.code ?? -1) && effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
    }))).toEqual([
      { code: 2, reset: { flags: 1107169792 } },
      { code: 8, reset: { flags: 1107169792 } },
    ]);
    expect(restoredNegated.session.state.effects.filter((effect) => effect.sourceUid === majestic.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107235328 }, value: 3200 },
    ]);
    expect(restoredNegated.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredEndPhase = restoreDuelWithLuaScripts(serializeDuel(restoredNegated.session), source, reader);
    expectCleanRestore(restoredEndPhase);
    expectRestoredLegalActions(restoredEndPhase, 0);
    restoredEndPhase.session.state.phase = "main2";
    restoredEndPhase.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredEndPhase, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEndPhase, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndPhase, endPhase!);
    const endTrigger = getLuaRestoreLegalActions(restoredEndPhase, 0).find((action) => action.type === "activateTrigger" && action.uid === majestic.uid);
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndPhase, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndPhase, endTrigger!);
    resolveRestoredChain(restoredEndPhase);
    expect(restoredEndPhase.session.state.cards.find((card) => card.uid === majestic.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: majestic.uid,
      reasonEffectId: 5,
    });
    expect(restoredEndPhase.session.state.cards.find((card) => card.uid === redDragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: majestic.uid,
      reasonEffectId: 5,
    });
    expect(restoredEndPhase.session.state.eventHistory.filter((event) => ["sentToDeck", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "sentToDeck", eventCardUid: majestic.uid, eventReasonPlayer: 0, eventReasonCardUid: majestic.uid, eventReasonEffectId: 5, eventUids: undefined },
      { eventName: "specialSummoned", eventCardUid: redDragon.uid, eventReasonPlayer: 0, eventReasonCardUid: majestic.uid, eventReasonEffectId: 5, eventUids: [redDragon.uid] },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddMajesticProcedure(c,aux.FilterBoolFunction(Card.IsCode,21159309),true,aux.FilterBoolFunction(Card.IsCode,CARD_RED_DRAGON_ARCHFIEND),true,Synchro.NonTuner(nil),false)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLED)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsDefensePos,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("Duel.AdjustInstantly(tc)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.SendtoDeck(c,nil,SEQ_DECKTOP,REASON_EFFECT)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e4:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e5:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("e1:SetCode(EFFECT_MULTIPLE_TUNERS)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => [majesticCode, redDragonCode].includes(card.code)),
    { code: targetCode, name: "Majestic Red Effect Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, level: 4, attack: 3200, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 67030233, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [redDragonCode], extra: [majesticCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  const source = { readScript(name: string) { return workspace.readScript(name); } };
  return { session, reader, source };
}

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
