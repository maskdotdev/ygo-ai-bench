import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, createDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const emperorCode = "61175706";
const allyCode = "611757060";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEmperorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${emperorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setArcanaForce = 0x5;
const categoryCoin = 0x1000000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasEmperorScript)("Lua real script Arcana Force Emperor coin field stat", () => {
  it("restores summon coin registration into Arcana Force field ATK update", () => {
    const restored = summonAndResolveCoin(10);
    const emperor = requireCard(restored.session, emperorCode);
    const ally = requireCard(restored.session, allyCode);

    expect(restored.session.state.lastCoinResults).toEqual([1]);
    expect(currentAttack(emperor, restored.session.state)).toBe(1900);
    expect(currentAttack(ally, restored.session.state)).toBe(1500);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === emperor.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: categoryCoin, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: categoryCoin, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: categoryCoin, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: undefined, code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], targetRange: [4, 0] },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: emperor.uid,
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
        eventReasonCardUid: emperor.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function summonAndResolveCoin(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const script = workspace.readScript(`official/c${emperorCode}.lua`);
  expectScriptShape(script);
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [emperorCode, allyCode] }, 1: { main: [] } });
  startDuel(session);

  const emperor = requireCard(session, emperorCode);
  const ally = requireCard(session, allyCode);
  moveDuelCard(session.state, emperor.uid, "hand", 0);
  moveFaceUpAttack(session, ally, 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(emperorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === emperor.uid);
  expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestored(restoredOpen, summon!);

  const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
  expectCleanRestore(restoredTrigger);
  expectRestoredLegalActions(restoredTrigger, 0);
  const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === emperor.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
  applyRestored(restoredTrigger, trigger!);
  passRestoredChain(restoredTrigger);
  return restoredTrigger;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force IV - The Emperor");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_ARCANA_FORCE))");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())");
  expect(script).toContain("return 500");
  expect(script).toContain("return -500");
}

function cards(): DuelCardData[] {
  return [
    { code: emperorCode, name: "Arcana Force IV - The Emperor", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1400, defense: 1400 },
    { code: allyCode, name: "Emperor Arcana Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
    const player = restored.session.state.waitingFor ?? 0;
    expectRestoredLegalActions(restored, player);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
