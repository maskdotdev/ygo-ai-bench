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
const typeMonster = 0x1;
const typeLink = 0x4000000;
const raceDragon = 0x2000;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Guardragon Elpy linked-count zone summon", () => {
  it("restores Duel.GetZoneWithLinkedCount(2,tp) and summons a Dragon into the shared linked zone", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const elpyCode = "86148577";
    const rightLinkCode = "86148578";
    const deckDragonCode = "86148579";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === elpyCode),
      { code: rightLinkCode, name: "Elpy Right Link Fixture", kind: "extra", typeFlags: typeMonster | typeLink, level: 1, race: raceDragon, attack: 1000, linkMarkers: 0x20 },
      { code: deckDragonCode, name: "Elpy Deck Dragon Target", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8614, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [deckDragonCode], extra: [elpyCode, rightLinkCode] }, 1: { main: [] } });
    startDuel(session);

    const elpy = requireCard(session, elpyCode);
    const rightLink = requireCard(session, rightLinkCode);
    const deckDragon = requireCard(session, deckDragonCode);
    moveDuelCard(session.state, rightLink.uid, "monsterZone", 0);
    rightLink.sequence = 0;
    rightLink.faceUp = true;
    rightLink.position = "faceUpAttack";
    moveDuelCard(session.state, elpy.uid, "monsterZone", 0);
    elpy.sequence = 2;
    elpy.faceUp = true;
    elpy.position = "faceUpAttack";
    moveDuelCard(session.state, deckDragon.uid, "deck", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(elpyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === elpy.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restored, action!);
    expect(summoned.ok, summoned.error).toBe(true);
    if (restored.session.state.waitingFor !== undefined) {
      expect(summoned.legalActions).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor));
      expect(summoned.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor));
      expect(summoned.legalActionGroups.flatMap((group) => group.actions)).toEqual(summoned.legalActions);
    }

    expect(restored.session.state.cards.find((card) => card.uid === elpy.uid)).toMatchObject({ location: "monsterZone", sequence: 2, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === rightLink.uid)).toMatchObject({ location: "monsterZone", sequence: 0, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === deckDragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === deckDragon.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: deckDragon.uid,
        eventUids: [deckDragon.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: elpy.uid,
        eventReasonEffectId: 3,
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
