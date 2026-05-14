import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Grandsoil leave-field Battle Phase skip", () => {
  it("restores Elemental Lord self-turn skip conditions after leaving the field", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const grandsoilCode = "61468779";
    const otherMonsterCode = "61468780";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === grandsoilCode),
      { code: otherMonsterCode, name: "Grandsoil Leave Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 614, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [grandsoilCode, otherMonsterCode] }, 1: { main: [] } });
    startDuel(session);

    const grandsoil = requireCard(session, grandsoilCode);
    moveDuelCard(session.state, grandsoil.uid, "monsterZone", 0);
    grandsoil.faceUp = true;
    grandsoil.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(grandsoilCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const leave = host.loadScript(
      `
      local grandsoil=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${grandsoilCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(grandsoil, EVENT_LEAVE_FIELD_P, nil, REASON_EFFECT, 0, 0, 0)
      Debug.Message("grandsoil leave event raised")
      `,
      "grandsoil-leaves-field.lua",
    );
    expect(leave.ok, leave.error).toBe(true);
    expect(host.messages).toContain("grandsoil leave event raised");
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: grandsoil.uid,
          code: 183,
          controller: 0,
          targetRange: [1, 0],
          reset: { flags: 0x50000200, count: 2 },
          label: expect.any(Number),
        }),
      ]),
    );

    const restoredSameTurn = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSameTurn.restoreComplete, restoredSameTurn.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSameTurn.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredSameTurn, 0)).toEqual(getDuelLegalActions(restoredSameTurn.session, 0));
    expect(getLuaRestoreLegalActions(restoredSameTurn, 0)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));

    moveToBattleMain2AndEnd(restoredSameTurn.session, 0);
    const restoredNextSelfTurn = restoreDuelWithLuaScripts(serializeDuel(restoredSameTurn.session), workspace, reader);
    expect(restoredNextSelfTurn.restoreComplete, restoredNextSelfTurn.incompleteReasons.join("; ")).toBe(true);
    expect(restoredNextSelfTurn.missingRegistryKeys).toEqual([]);
    expect(restoredNextSelfTurn.session.state).toMatchObject({ turnPlayer: 1, phase: "main1" });
    applyActionAndAssert(restoredNextSelfTurn.session, getDuelLegalActions(restoredNextSelfTurn.session, 1).find((action) => action.type === "endTurn"));
    expect(restoredNextSelfTurn.session.state).toMatchObject({ turnPlayer: 0, phase: "main1" });
    const selfTurnActions = getLuaRestoreLegalActions(restoreDuelWithLuaScripts(serializeDuel(restoredNextSelfTurn.session), workspace, reader), 0);
    expect(selfTurnActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "main2" })]));
    expect(selfTurnActions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveToBattleMain2AndEnd(session: DuelSession, player: 0 | 1): void {
  for (const phase of ["battle", "main2"] as const) {
    applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "changePhase" && action.phase === phase));
  }
  applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "endTurn"));
}

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
