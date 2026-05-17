import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { currentAttack } from "#duel/card-stats.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Knightmare Corruptor Iblee to-be-linked zone summon", () => {
  it("restores GetToBeLinkedZone targeting and revives a Link monster into its future pointed zone", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ibleeCode = "10158145";
    const linkTargetCode = "10158146";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ibleeCode),
      { code: linkTargetCode, name: "Iblee To-Be-Linked Target", kind: "extra", typeFlags: 0x4000001, level: 1, attack: 2000, linkMarkers: 0x8 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1015, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ibleeCode], extra: [linkTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const iblee = requireCard(session, ibleeCode);
    const linkTarget = requireCard(session, linkTargetCode);
    moveDuelCard(session.state, iblee.uid, "hand", 0);
    moveDuelCard(session.state, linkTarget.uid, "graveyard", 0);
    linkTarget.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ibleeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === iblee.uid);
    expect(summon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.cards.find((card) => card.uid === iblee.uid)).toMatchObject({ location: "monsterZone", sequence: 0, faceUp: true });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === iblee.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(trigger).toMatchObject({ windowKind: "triggerBucket" });
    const revived = applyLuaRestoreResponse(restored, trigger!);
    expect(revived.ok, revived.error).toBe(true);
    if (restored.session.state.waitingFor !== undefined) {
      expect(revived.legalActions).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor));
      expect(revived.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor));
      expect(revived.legalActionGroups.flatMap((group) => group.actions)).toEqual(revived.legalActions);
    }

    const restoredLinkTarget = restored.session.state.cards.find((card) => card.uid === linkTarget.uid);
    expect(restoredLinkTarget).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(currentAttack(restoredLinkTarget, restored.session.state)).toBe(0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === linkTarget.uid).map((effect) => effect.code ?? 0).sort((left, right) => left - right)).toEqual([2, 8, 102]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === linkTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: linkTarget.uid,
        eventUids: [linkTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: iblee.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
