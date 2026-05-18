import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSynchro = 0x2000;
const typeSpell = 0x2;
const setMalefic = 0x23;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Malefic Stardust Special Summon procedure", () => {
  it("restores Extra Deck material selection, banish cost, and hand Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const maleficCode = "36521459";
    const stardustCode = "44508094";
    const offCodeExtraCode = "36521460";
    const fieldSpellCode = "36521461";
    const maleficScript = workspace.readScript(`c${maleficCode}.lua`);
    expect(maleficScript).toContain("aux.AddMaleficSummonProcedure(c,CARD_STARDUST_DRAGON,LOCATION_EXTRA)");
    expect(maleficScript).toContain("c:SetUniqueOnField(1,1,aux.MaleficUniqueFilter(c),LOCATION_MZONE)");
    expect(maleficScript).toContain("return not Duel.IsExistingMatchingCard(Card.IsFaceup,0,LOCATION_FZONE,LOCATION_FZONE,1,nil)");

    const cards: DuelCardData[] = [
      { code: maleficCode, name: "Malefic Stardust Dragon", kind: "monster", typeFlags: typeMonster, setcodes: [setMalefic], level: 8, attack: 2500, defense: 2000 },
      { code: stardustCode, name: "Stardust Dragon", kind: "monster", typeFlags: typeMonster | typeSynchro, level: 8, attack: 2500, defense: 2000 },
      { code: offCodeExtraCode, name: "Off-Code Extra Deck Dragon", kind: "monster", typeFlags: typeMonster | typeSynchro, level: 8, attack: 2400, defense: 1800 },
      { code: fieldSpellCode, name: "Malefic Field Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 36521459, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [maleficCode, fieldSpellCode], extra: [stardustCode, offCodeExtraCode] },
      1: { main: [] },
    });
    startDuel(session);

    const malefic = session.state.cards.find((card) => card.code === maleficCode);
    const stardust = session.state.cards.find((card) => card.code === stardustCode);
    const offCodeExtra = session.state.cards.find((card) => card.code === offCodeExtraCode);
    const fieldSpell = session.state.cards.find((card) => card.code === fieldSpellCode);
    expect(malefic).toBeDefined();
    expect(stardust).toBeDefined();
    expect(offCodeExtra).toBeDefined();
    expect(fieldSpell).toBeDefined();
    moveDuelCard(session.state, malefic!.uid, "hand", 0);
    moveDuelCard(session.state, stardust!.uid, "extraDeck", 0);
    moveDuelCard(session.state, offCodeExtra!.uid, "extraDeck", 0);
    const movedFieldSpell = moveDuelCard(session.state, fieldSpell!.uid, "spellTrapZone", 0);
    movedFieldSpell.sequence = 5;
    movedFieldSpell.faceUp = true;
    movedFieldSpell.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maleficCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === malefic!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(procedure).toMatchObject({ windowKind: "open", label: "Special Summon Malefic Stardust Dragon" });
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === malefic!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === stardust!.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: malefic!.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === offCodeExtra!.uid)).toMatchObject({ location: "extraDeck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fieldSpell!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true, sequence: 5 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === stardust!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: stardust!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: malefic!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: malefic!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
