import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Spiritual Energy Settle Machine return lock", () => {
  it("restores its Spirit return suppression and leave-field return-all cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const settleMachineCode = "99173029";
    const yataCode = "3078576";
    const opponentSpiritCode = "99173030";
    const faceDownSpiritCode = "99173031";
    const nonSpiritCode = "99173032";
    const maintenanceCostCode = "99173033";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === settleMachineCode || card.code === yataCode),
      { code: opponentSpiritCode, name: "Settle Machine Opponent Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1500, defense: 1200 },
      { code: faceDownSpiritCode, name: "Settle Machine Face-Down Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1000, defense: 1000 },
      { code: nonSpiritCode, name: "Settle Machine Non-Spirit", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: maintenanceCostCode, name: "Settle Machine Maintenance Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 800, defense: 800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 991, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [settleMachineCode, yataCode, faceDownSpiritCode, maintenanceCostCode] }, 1: { main: [opponentSpiritCode, nonSpiritCode] } });
    startDuel(session);

    const settleMachine = requireCard(session, settleMachineCode);
    const yata = requireCard(session, yataCode);
    const opponentSpirit = requireCard(session, opponentSpiritCode);
    const faceDownSpirit = requireCard(session, faceDownSpiritCode);
    const nonSpirit = requireCard(session, nonSpiritCode);
    const maintenanceCost = requireCard(session, maintenanceCostCode);
    moveDuelCard(session.state, settleMachine.uid, "spellTrapZone", 0);
    settleMachine.faceUp = true;
    moveDuelCard(session.state, yata.uid, "hand", 0);
    moveDuelCard(session.state, maintenanceCost.uid, "hand", 0);
    moveDuelCard(session.state, opponentSpirit.uid, "monsterZone", 1);
    opponentSpirit.faceUp = true;
    opponentSpirit.position = "faceUpAttack";
    moveDuelCard(session.state, faceDownSpirit.uid, "monsterZone", 0);
    faceDownSpirit.faceUp = false;
    faceDownSpirit.position = "faceDownDefense";
    moveDuelCard(session.state, nonSpirit.uid, "monsterZone", 1);
    nonSpirit.faceUp = true;
    nonSpirit.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(settleMachineCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(yataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    applyActionAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === yata.uid));
    for (const phase of ["battle", "main2", "end"] as const) {
      applyActionAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === phase));
    }
    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.cards.find((card) => card.uid === yata.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === maintenanceCost.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === settleMachine.uid)).toMatchObject({ location: "spellTrapZone" });

    const restoredReturnLock = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredReturnLock.restoreComplete, restoredReturnLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredReturnLock.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredReturnLock, 0)).toEqual(getDuelLegalActions(restoredReturnLock.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredReturnLock, 0)).toEqual(getGroupedDuelLegalActions(restoredReturnLock.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredReturnLock, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredReturnLock, 0));
    expect(getLuaRestoreLegalActions(restoredReturnLock, 0).some((action) => action.type === "activateTrigger" && action.uid === yata.uid)).toBe(false);
    expect(restoredReturnLock.session.state.cards.find((card) => card.uid === yata.uid)).toMatchObject({ location: "monsterZone" });

    const leave = restoredReturnLock.host.loadScript(
      `
      local machine=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${settleMachineCode}), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("settle leaves " .. Duel.SendtoGrave(machine, REASON_EFFECT))
      `,
      "settle-machine-leaves-field.lua",
    );
    expect(leave.ok, leave.error).toBe(true);
    expect(restoredReturnLock.host.messages).toContain("settle leaves 1");
    expect(restoredReturnLock.session.state.cards.find((card) => card.uid === settleMachine.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredReturnLock.session.state.cards.find((card) => card.uid === yata.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredReturnLock.session.state.cards.find((card) => card.uid === opponentSpirit.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredReturnLock.session.state.cards.find((card) => card.uid === faceDownSpirit.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredReturnLock.session.state.cards.find((card) => card.uid === nonSpirit.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredReturnLock.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: yata.uid }),
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: opponentSpirit.uid }),
      ]),
    );
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
