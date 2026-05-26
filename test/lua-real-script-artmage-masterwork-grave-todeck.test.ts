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
const masterworkCode = "37517035";
const artmageACode = "375170350";
const artmageBCode = "375170351";
const artmageCCode = "375170352";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMasterworkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${masterworkCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const setArtmage = 0x1c7;

describe.skipIf(!hasUpstreamScripts || !hasMasterworkScript)("Lua real script Artmage Masterwork grave to-Deck", () => {
  it("restores grave self-banish into three distinct Artmage targets shuffled to Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${masterworkCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 37517035, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [masterworkCode, artmageACode, artmageBCode, artmageCCode] }, 1: { main: [] } });
    startDuel(session);

    const masterwork = requireCard(session, masterworkCode);
    const artmageA = requireCard(session, artmageACode);
    const artmageB = requireCard(session, artmageBCode);
    const artmageC = requireCard(session, artmageCCode);
    for (const card of [masterwork, artmageA, artmageB, artmageC]) {
      moveDuelCard(session.state, card.uid, "graveyard", 0).faceUp = true;
    }
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(masterworkCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const shuffle = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === masterwork.uid && action.effectId === "lua-2");
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, shuffle!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === masterwork.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: masterwork.uid,
      reasonEffectId: 2,
    });
    const operationInfos = restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? []);
    expect(operationInfos).toEqual([]);
    resolveRestoredChain(restoredOpen);

    for (const card of [artmageA, artmageB, artmageC]) {
      expect(restoredOpen.session.state.cards.find((candidate) => candidate.uid === card.uid)).toMatchObject({
        location: "deck",
        controller: 0,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: masterwork.uid,
        reasonEffectId: 2,
      });
    }
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "sentToDeck"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "banished", eventCardUid: masterwork.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: masterwork.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
      { current: "deck", eventCardUid: artmageA.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: masterwork.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
      { current: "deck", eventCardUid: artmageB.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: masterwork.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
      { current: "deck", eventCardUid: artmageC.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: masterwork.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
      { current: "deck", eventCardUid: artmageA.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: masterwork.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Artmage Masterwork -Succession-");
  expect(script).toContain("Fusion.CreateSummonEff({handler=c,extrafil=s.fextra,stage2=s.atkop,extratg=s.atktg})");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsMainPhase() end)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,nil,1,tp,500)");
  expect(script).toContain("Duel.IsExistingMatchingCard(nil,0,LOCATION_FZONE,LOCATION_FZONE,1,nil)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetMatchingGroup(s.tdfilter,tp,LOCATION_GRAVE,0,e:GetHandler(),e)");
  expect(script).toContain("g:GetClassCount(Card.GetCode)>=3");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,3,3,aux.dncheck,1,tp,HINTMSG_TODECK)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SendtoDeck(tg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: masterworkCode, name: "Artmage Masterwork -Succession-", kind: "spell", typeFlags: typeSpell, setcodes: [setArtmage] },
    { code: artmageACode, name: "Artmage Fixture A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, setcodes: [setArtmage] },
    { code: artmageBCode, name: "Artmage Fixture B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1100, defense: 1000, setcodes: [setArtmage] },
    { code: artmageCCode, name: "Artmage Fixture C", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000, setcodes: [setArtmage] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
