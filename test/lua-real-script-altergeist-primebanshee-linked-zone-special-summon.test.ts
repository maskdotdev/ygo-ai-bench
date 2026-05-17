import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setAltergeist = 0x103;
const typeMonster = 0x1;
const typeEffect = 0x20;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Altergeist Primebanshee linked-zone Special Summon", () => {
  it("restores its GetLinkedZone(tp) release cost and summons from Deck into the opened linked zone", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const primebansheeCode = "93503294";
    const releaseCode = "93503295";
    const summonCode = "93503296";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === primebansheeCode),
      { code: releaseCode, name: "Primebanshee Linked Altergeist Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAltergeist], level: 4, attack: 1000, defense: 1000 },
      { code: summonCode, name: "Primebanshee Deck Altergeist Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAltergeist], level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9350, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [releaseCode, summonCode], extra: [primebansheeCode] }, 1: { main: [] } });
    startDuel(session);

    const primebanshee = requireCard(session, primebansheeCode);
    const release = requireCard(session, releaseCode);
    const summon = requireCard(session, summonCode);
    moveDuelCard(session.state, primebanshee.uid, "monsterZone", 0).sequence = 0;
    primebanshee.faceUp = true;
    primebanshee.position = "faceUpAttack";
    moveDuelCard(session.state, release.uid, "monsterZone", 0).sequence = 1;
    release.faceUp = true;
    release.position = "faceUpAttack";
    moveDuelCard(session.state, summon.uid, "deck", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(primebansheeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === primebanshee.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, action!);
    expect(resolved.ok, resolved.error).toBe(true);
    if (restored.session.state.waitingFor !== undefined) {
      expect(resolved.legalActions).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor));
      expect(resolved.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor));
      expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    }

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.cards.find((card) => card.uid === primebanshee.uid)).toMatchObject({ location: "monsterZone", sequence: 0, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === summon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summon.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summon.uid,
        eventUids: [summon.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: primebanshee.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
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
