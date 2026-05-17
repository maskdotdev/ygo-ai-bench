import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceWarrior = 0x1;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Summon Sorceress opponent linked zone", () => {
  it("restores GetLinkedZone(1-tp) and summons a hand monster to the opponent field", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sorceressCode = "61665245";
    const firstMaterialCode = "61665246";
    const secondMaterialCode = "61665247";
    const thirdMaterialCode = "61665250";
    const handSummonCode = "61665248";
    const deckSummonCode = "61665249";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb")
        .filter((card) => card.code === sorceressCode)
        .map((card) => ({ ...card, linkMaterials: [firstMaterialCode, secondMaterialCode, thirdMaterialCode], linkMaterialMin: 3, linkMaterialMax: 3 })),
      { code: firstMaterialCode, name: "Summon Sorceress Warrior Material A", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: secondMaterialCode, name: "Summon Sorceress Warrior Material B", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: thirdMaterialCode, name: "Summon Sorceress Warrior Material C", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: handSummonCode, name: "Summon Sorceress Hand Warrior", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1500, defense: 1200 },
      { code: deckSummonCode, name: "Summon Sorceress Deck Warrior", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6166, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [firstMaterialCode, secondMaterialCode, thirdMaterialCode, handSummonCode, deckSummonCode], extra: [sorceressCode] }, 1: { main: [] } });
    startDuel(session);

    const sorceress = requireCard(session, sorceressCode);
    const firstMaterial = requireCard(session, firstMaterialCode);
    const secondMaterial = requireCard(session, secondMaterialCode);
    const thirdMaterial = requireCard(session, thirdMaterialCode);
    const handSummon = requireCard(session, handSummonCode);
    const deckSummon = requireCard(session, deckSummonCode);
    moveDuelCard(session.state, firstMaterial.uid, "monsterZone", 0);
    firstMaterial.sequence = 0;
    firstMaterial.faceUp = true;
    firstMaterial.position = "faceUpAttack";
    moveDuelCard(session.state, secondMaterial.uid, "monsterZone", 0);
    secondMaterial.sequence = 1;
    secondMaterial.faceUp = true;
    secondMaterial.position = "faceUpAttack";
    moveDuelCard(session.state, thirdMaterial.uid, "monsterZone", 0);
    thirdMaterial.sequence = 2;
    thirdMaterial.faceUp = true;
    thirdMaterial.position = "faceUpAttack";
    moveDuelCard(session.state, handSummon.uid, "hand", 0);
    handSummon.sequence = 0;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sorceressCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const linkSummon = getLegalActions(session, 0).find((action) => action.type === "linkSummon" && action.uid === sorceress.uid);
    expect(linkSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, linkSummon!);
    expect(session.state.cards.find((card) => card.uid === sorceress.uid)).toMatchObject({ location: "monsterZone", sequence: 0, summonType: "link" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === sorceress.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(trigger).toMatchObject({ windowKind: "triggerBucket" });
    const summoned = applyLuaRestoreResponse(restored, trigger!);
    expect(summoned.ok, summoned.error).toBe(true);
    if (restored.session.state.waitingFor !== undefined) {
      expect(summoned.legalActions).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor));
      expect(summoned.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor));
      expect(summoned.legalActionGroups.flatMap((group) => group.actions)).toEqual(summoned.legalActions);
    }

    expect(restored.session.state.cards.find((card) => card.uid === handSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      sequence: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === deckSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === handSummon.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handSummon.uid,
        eventUids: [handSummon.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: sorceress.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
