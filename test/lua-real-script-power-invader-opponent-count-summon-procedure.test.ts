import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const upstreamConditionSnippet = "Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE)>=2";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Power Invader opponent-count summon procedure", () => {
  it("restores its no-tribute Normal Summon procedure gated by two opponent monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const powerInvaderCode = "18842395";
    const firstOpponentMonsterCode = "89631139";
    const secondOpponentMonsterCode = "46986414";
    const opponentMonsterCodes = [firstOpponentMonsterCode, secondOpponentMonsterCode];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [powerInvaderCode, ...opponentMonsterCodes].includes(card.code)),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 188, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [powerInvaderCode] }, 1: { main: opponentMonsterCodes } });
    startDuel(session);

    const powerInvader = requireCard(session, powerInvaderCode);
    const firstOpponentMonster = requireCard(session, firstOpponentMonsterCode);
    const secondOpponentMonster = requireCard(session, secondOpponentMonsterCode);
    moveDuelCard(session.state, powerInvader.uid, "hand", 0);
    moveDuelCard(session.state, firstOpponentMonster.uid, "monsterZone", 1);
    firstOpponentMonster.faceUp = true;
    firstOpponentMonster.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(powerInvaderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === powerInvader.uid).map((effect) => effect.luaConditionDescriptor)).toEqual([
      "condition:normal-summon-proc-opponent-mzone-count-at-least:2:source-level-above:4",
    ]);

    const blocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(blocked.restoreComplete, blocked.incompleteReasons.join("; ")).toBe(true);
    expect(blocked.missingRegistryKeys).toEqual([]);
    expect(blocked.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(blocked, 0)).toEqual(getGroupedDuelLegalActions(blocked.session, 0));
    expect(getLuaRestoreLegalActionGroups(blocked, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(blocked, 0));
    expect(getLuaRestoreLegalActions(blocked, 0).filter((action) => action.type === "tributeSummon" && action.uid === powerInvader.uid)).toEqual([]);

    expect(upstreamConditionSnippet).toBe("Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE)>=2");
    moveDuelCard(session.state, secondOpponentMonster.uid, "monsterZone", 1);
    secondOpponentMonster.faceUp = true;
    secondOpponentMonster.position = "faceUpAttack";
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const summon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "tributeSummon" && action.uid === powerInvader.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual(expect.objectContaining({
      type: "tributeSummon",
      effectId: expect.stringMatching(/^lua-/),
      tributeUids: [],
    }));
    const summoned = applyLuaRestoreResponse(restored, summon!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === powerInvader.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
      summonMaterialUids: [],
    });
    expect(restored.session.state.players[0].normalSummonAvailable).toBe(false);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: powerInvader.uid,
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
