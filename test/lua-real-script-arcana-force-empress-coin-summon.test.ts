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
const empressCode = "35781051";
const handArcanaCode = "357810510";
const opponentSummonCode = "357810511";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEmpressScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${empressCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setArcanaForce = 0x5;

describe.skipIf(!hasUpstreamScripts || !hasEmpressScript)("Lua real script Arcana Force Empress coin summon", () => {
  it("restores summon TossCoin registration into heads opponent-summon hand Special Summon trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${empressCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 97452817, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [empressCode, handArcanaCode] }, 1: { main: [opponentSummonCode] } });
    startDuel(session);

    const empress = requireCard(session, empressCode);
    const handArcana = requireCard(session, handArcanaCode);
    const opponentSummon = requireCard(session, opponentSummonCode);
    moveDuelCard(session.state, empress.uid, "hand", 0);
    moveDuelCard(session.state, handArcana.uid, "hand", 0);
    moveDuelCard(session.state, opponentSummon.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(empressCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === empress.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, summon!);

    const restoredCoinTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredCoinTrigger);
    expectRestoredLegalActions(restoredCoinTrigger, 0);
    const coinTrigger = getLuaRestoreLegalActions(restoredCoinTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === empress.uid);
    expect(coinTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCoinTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoinTrigger, coinTrigger!);
    passRestoredChain(restoredCoinTrigger);

    expect(restoredCoinTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredCoinTrigger.session.state.effects.filter((effect) => effect.sourceUid === empress.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: 16777216, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 16777216, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 16777216, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 512, code: 1100, event: "trigger", range: ["monsterZone"] },
      { category: 512, code: 1106, event: "trigger", range: ["monsterZone"] },
      { category: 32, code: 1100, event: "trigger", range: ["monsterZone"] },
      { category: 32, code: 1106, event: "trigger", range: ["monsterZone"] },
    ]);

    restoredCoinTrigger.session.state.turnPlayer = 1;
    restoredCoinTrigger.session.state.waitingFor = 1;
    const opponentNormal = getLuaRestoreLegalActions(restoredCoinTrigger, 1).find((action) => action.type === "normalSummon" && action.uid === opponentSummon.uid);
    expect(opponentNormal, JSON.stringify(getLuaRestoreLegalActions(restoredCoinTrigger, 1), null, 2)).toBeDefined();
    applyRestored(restoredCoinTrigger, opponentNormal!);

    expectRestoredLegalActions(restoredCoinTrigger, 0);
    const followup = getLuaRestoreLegalActions(restoredCoinTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === empress.uid);
    expect(followup, JSON.stringify(getLuaRestoreLegalActions(restoredCoinTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoinTrigger, followup!);
    passRestoredChain(restoredCoinTrigger);

    expect(restoredCoinTrigger.session.state.cards.find((card) => card.uid === handArcana.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: empress.uid,
      reasonEffectId: 4,
    });
    expect(restoredCoinTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: empress.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: empress.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: opponentSummon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handArcana.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: empress.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventUids: [handArcana.uid],
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force III - The Empress");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_HEADS");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_TAILS");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_HAND)");
}

function cards(): DuelCardData[] {
  return [
    { code: empressCode, name: "Arcana Force III - The Empress", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1300, defense: 1300 },
    { code: handArcanaCode, name: "Arcana Force Hand Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1000, defense: 1000 },
    { code: opponentSummonCode, name: "Opponent Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestored(restored, pass!);
  }
}
