import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Escher opponent backrow Special Summon procedure", () => {
  it("restores its hand procedure gated by two opponent Spell/Trap cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const escherCode = "24326617";
    const opponentSpellCode = "900002432";
    const opponentTrapCode = "900002433";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === escherCode),
      { code: opponentSpellCode, name: "Escher Opponent Spell Fixture", kind: "spell", typeFlags: 0x2 },
      { code: opponentTrapCode, name: "Escher Opponent Trap Fixture", kind: "trap", typeFlags: 0x4 },
    ];
    const script = workspace.readScript(`official/c${escherCode}.lua`);
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,0,LOCATION_SZONE,2,nil)");
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 243, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [escherCode] }, 1: { main: [opponentSpellCode, opponentTrapCode] } });
    startDuel(session);

    const escher = session.state.cards.find((card) => card.code === escherCode);
    const opponentSpell = session.state.cards.find((card) => card.code === opponentSpellCode);
    const opponentTrap = session.state.cards.find((card) => card.code === opponentTrapCode);
    expect(escher).toBeDefined();
    expect(opponentSpell).toBeDefined();
    expect(opponentTrap).toBeDefined();
    moveDuelCard(session.state, escher!.uid, "hand", 0);
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 1);
    moveDuelCard(session.state, opponentTrap!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(escherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === escher!.uid)).toBe(false);

    moveDuelCard(session.state, opponentTrap!.uid, "spellTrapZone", 1);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));

    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === escher!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === escher!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSpell!.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentTrap!.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: escher!.uid,
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
