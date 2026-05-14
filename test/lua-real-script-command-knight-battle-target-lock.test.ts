import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Command Knight battle target lock", () => {
  it("restores its aux.imval1 battle target lock while another controller monster is present", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const commandKnightCode = "10375182";
    const attackerCode = "10375183";
    const openTargetCode = "10375184";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === commandKnightCode),
      { code: attackerCode, name: "Command Knight Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: openTargetCode, name: "Command Knight Open Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1037, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [commandKnightCode, openTargetCode] } });
    startDuel(session);

    const attacker = requireCard(session, attackerCode);
    const commandKnight = requireCard(session, commandKnightCode);
    const openTarget = requireCard(session, openTargetCode);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0);
    attacker.faceUp = true;
    attacker.position = "faceUpAttack";
    for (const card of [commandKnight, openTarget]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 1);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(commandKnightCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 70, sourceUid: commandKnight.uid })]));
    const groups = getLuaRestoreLegalActionGroups(restored, 0);
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(groups.flatMap((group) => group.actions)).toEqual(actions);
    expect(hasAttack(actions, attacker.uid, commandKnight.uid)).toBe(false);
    expect(hasAttack(actions, attacker.uid, openTarget.uid)).toBe(true);
  });
});

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
