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
const leonisCode = "17129783";
const hasLeonisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leonisCode}.lua`));
const setConstellar = 0x53;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasLeonisScript)("Lua real script Constellar Leonis extra summon count", () => {
  it("restores Leonis's extra Constellar Normal Summon after the regular summon is spent", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const firstSummonCode = "17129784";
    const extraSummonCode = "17129785";
    const script = workspace.readScript(`c${leonisCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_CONSTELLAR))");
    const cards: DuelCardData[] = [
      { code: leonisCode, name: "Constellar Leonis", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setConstellar], level: 3, attack: 1000, defense: 1800 },
      { code: firstSummonCode, name: "Constellar First Summon", kind: "monster", typeFlags: typeMonster, setcodes: [setConstellar], level: 4, attack: 1200, defense: 1000 },
      { code: extraSummonCode, name: "Constellar Extra Summon", kind: "monster", typeFlags: typeMonster, setcodes: [setConstellar], level: 4, attack: 1300, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 171, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [leonisCode, firstSummonCode, extraSummonCode] }, 1: { main: [] } });
    startDuel(session);

    const leonis = requireCard(session, leonisCode);
    const firstSummon = requireCard(session, firstSummonCode);
    const extraSummon = requireCard(session, extraSummonCode);
    moveDuelCard(session.state, leonis.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstSummon.uid, "hand", 0);
    moveDuelCard(session.state, extraSummon.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leonisCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const regularSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === firstSummon.uid);
    expect(regularSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, regularSummon!);
    expect(session.state.players[0].normalSummonAvailable).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const extraAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "normalSummon" && action.uid === extraSummon.uid);
    expect(extraAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restored, extraAction!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === extraSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
    });
    expect(restored.session.state.activityCounts[0].normalSummon).toBe(2);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: firstSummon.uid,
        eventReason: duelReason.summon,
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
          sequence: 1,
        },
      },
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: extraSummon.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 2,
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
