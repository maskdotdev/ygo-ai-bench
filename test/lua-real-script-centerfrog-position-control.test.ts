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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const centerfrogCode = "47346782";
const targetCode = "473467820";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceAqua = 0x40;
const attributeWater = 0x10;
const effectCannotBeMaterial = 248;
const effectFlagCannotDisable = 0x400;
const effectFlagUncopyable = 0x40000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Centerfrog position control", () => {
  it("restores material lock registration and ignition control between Centerfrogs", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${centerfrogCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_MATERIAL)");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.CheckLocation(tp,LOCATION_MZONE,seq-1)");
    expect(script).toContain("Duel.GetControl(c,1-tp,0,0,zone)");
    expect(script).toContain("Duel.GetControl(g2,tp)");

    const cards: DuelCardData[] = [
      { code: centerfrogCode, name: "Centerfrog", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, race: raceAqua, level: 2, attack: 100, defense: 2000 },
      { code: targetCode, name: "Centerfrog Middle Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, race: raceAqua, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 47346782, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [centerfrogCode] }, 1: { main: [centerfrogCode, targetCode] } });
    startDuel(session);

    const ownCenterfrog = requireCards(session, centerfrogCode).find((card) => card.owner === 0)!;
    const opponentCenterfrog = requireCards(session, centerfrogCode).find((card) => card.owner === 1)!;
    const target = requireCards(session, targetCode)[0]!;
    moveFaceUpDefense(session, ownCenterfrog, 0, 0);
    moveFaceUpAttack(session, target, 1, 2);
    moveFaceUpAttack(session, opponentCenterfrog, 1, 3);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(centerfrogCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ownCenterfrog.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: effectCannotBeMaterial, event: "continuous", property: effectFlagCannotDisable | effectFlagUncopyable, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
      { category: 0x1000, code: 1100, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: 0x1000, code: 1101, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { category: categoryControl, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restoredOpen, 0);
    const control = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === ownCenterfrog.uid && action.effectId === "lua-4"
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, control!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownCenterfrog.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      position: "faceUpDefense",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ownCenterfrog.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ownCenterfrog.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged")).toEqual([
      expect.objectContaining({
        eventCardUid: ownCenterfrog.uid,
        eventReason: duelReason.effect,
        eventReasonCardUid: ownCenterfrog.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
      }),
      expect.objectContaining({
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonCardUid: ownCenterfrog.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
      }),
    ]);
  });
});

function requireCards(session: DuelSession, code: string): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  return cards;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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
