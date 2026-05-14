import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Misfortune cannot-attack lock", () => {
  it("restores its activation-cost attack oath and suppresses later battle actions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const misfortuneCode = "1036974";
    const attackerCode = "1036975";
    const targetCode = "1036976";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === misfortuneCode),
      { code: attackerCode, name: "Misfortune Locked Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: targetCode, name: "Misfortune Damage Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1036, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [misfortuneCode, attackerCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const misfortune = requireCard(session, misfortuneCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, misfortune.uid, "hand", 0);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0);
    attacker.faceUp = true;
    attacker.position = "faceUpAttack";
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.faceUp = true;
    target.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(misfortuneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === misfortune.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.effects.find((effect) => effect.sourceUid === misfortune.uid && effect.code === 85)).toMatchObject({
      event: "continuous",
      targetRange: [0x04, 0],
      reset: { flags: 0x40000200 },
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7000);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    restoredLock.session.state.phase = "battle";
    restoredLock.session.state.waitingFor = 0;
    const battleActions = getLuaRestoreLegalActions(restoredLock, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid)).toBe(false);
    expect(restoredLock.host.loadScript(cardCanAttackProbe(attackerCode), "misfortune-can-attack-probe.lua").ok).toBe(true);
    expect(restoredLock.host.messages).toContain("misfortune attacker can attack false");
  });
});

function cardCanAttackProbe(attackerCode: string): string {
  return `
    local attacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${attackerCode}),0,LOCATION_MZONE,0,nil)
    Debug.Message("misfortune attacker can attack " .. tostring(attacker:CanAttack()))
  `;
}

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
