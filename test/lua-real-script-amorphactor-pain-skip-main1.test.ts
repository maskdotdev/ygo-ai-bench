import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeRitual } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Amorphactor Pain Main Phase 1 skip", () => {
  it("restores its ritual-summon opponent Main Phase 1 skip as legal-action lockout", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const amorphactorCode = "98287529";
    const opponentMonsterCode = "98287530";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === amorphactorCode),
      { code: opponentMonsterCode, name: "Amorphactor Opponent Normal Summon", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 982, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [amorphactorCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const amorphactor = requireCard(session, amorphactorCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, amorphactor.uid, "monsterZone", 0);
    amorphactor.faceUp = true;
    amorphactor.position = "faceUpAttack";
    amorphactor.summonType = "ritual";
    amorphactor.summonTypeCode = luaSummonTypeRitual;
    moveDuelCard(session.state, opponentMonster.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(amorphactorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const summonSuccess = host.loadScript(
      `
      local amorphactor=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${amorphactorCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(amorphactor, EVENT_SPSUMMON_SUCCESS, nil, REASON_SPSUMMON, 0, 0, 0)
      Debug.Message("amorphactor ritual success raised")
      `,
      "amorphactor-ritual-success.lua",
    );
    expect(summonSuccess.ok, summonSuccess.error).toBe(true);
    expect(host.messages).toContain("amorphactor ritual success raised");
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: amorphactor.uid,
          code: 182,
          controller: 0,
          targetRange: [0, 1],
          reset: { flags: 0x60000200, count: 1 },
          label: expect.any(Number),
        }),
      ]),
    );

    const restoredEffect = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEffect.restoreComplete, restoredEffect.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredEffect, 0);
    expect(restoredEffect.missingRegistryKeys).toEqual([]);
    expect(restoredEffect.missingChainLimitRegistryKeys).toEqual([]);
    applyActionAndAssert(restoredEffect.session, getLuaRestoreLegalActions(restoredEffect, 0).find((action) => action.type === "endTurn"));

    const restoredOpponentMain = restoreDuelWithLuaScripts(serializeDuel(restoredEffect.session), workspace, reader);
    expect(restoredOpponentMain.restoreComplete, restoredOpponentMain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredOpponentMain, 1);
    expect(restoredOpponentMain.missingRegistryKeys).toEqual([]);
    expect(restoredOpponentMain.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredOpponentMain.session.state).toMatchObject({ turnPlayer: 1, phase: "main1", waitingFor: 1 });
    expect(getLuaRestoreLegalActionGroups(restoredOpponentMain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpponentMain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredOpponentMain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpponentMain, 1));
    const actions = getLuaRestoreLegalActions(restoredOpponentMain, 1);
    expect(actions).toEqual(getDuelLegalActions(restoredOpponentMain.session, 1));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: opponentMonster.uid })]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
