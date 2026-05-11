import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ring of Magnetism only-attack lock", () => {
  it("restores its equipped-monster-only attack surface", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ringCode = "20436034";
    const attackerCode = "20436035";
    const equippedTargetCode = "20436036";
    const sideTargetCode = "20436037";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ringCode),
      { code: attackerCode, name: "Ring Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: equippedTargetCode, name: "Ring Equipped Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
      { code: sideTargetCode, name: "Ring Side Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2043, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ringCode, equippedTargetCode, sideTargetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const ring = requireCard(session, ringCode);
    const attacker = requireCard(session, attackerCode);
    const equippedTarget = requireCard(session, equippedTargetCode);
    const sideTarget = requireCard(session, sideTargetCode);
    moveFaceUpAttack(session, equippedTarget, 0);
    moveFaceUpAttack(session, sideTarget, 0);
    moveFaceUpAttack(session, attacker, 1);
    moveFaceUpEquip(session, ring, 0, equippedTarget.uid);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ringCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 196, sourceUid: ring.uid }),
        expect.objectContaining({ event: "continuous", code: 343, sourceUid: ring.uid }),
      ]),
    );
    const actions = getLuaRestoreLegalActions(restored, 1);
    expect(hasAttack(actions, attacker.uid, equippedTarget.uid)).toBe(true);
    expect(hasAttack(actions, attacker.uid, sideTarget.uid)).toBe(false);
    expect(actions.some((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.directAttack)).toBe(false);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function moveFaceUpEquip(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1, equippedToUid: string): void {
  moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  card.faceUp = true;
  card.equippedToUid = equippedToUid;
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
