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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ghost Bird of Bewitchment extra monster attack", () => {
  it("restores sequence-gated monster-only extra attacks without allowing direct attacks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ghostBirdCode = "15419596";
    const targetCode = "15419597";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ghostBirdCode),
      { code: targetCode, name: "Ghost Bird Extra Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1541, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ghostBirdCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const ghostBird = requireCard(session, ghostBirdCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, ghostBird, 0);
    moveFaceUpAttack(session, target, 1);
    ghostBird.sequence = 4;
    session.state.attacksDeclared.push(ghostBird.uid);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ghostBirdCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 346, sourceUid: ghostBird.uid })]),
    );
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, ghostBird.uid, target.uid)).toBe(true);
    expect(hasDirectAttack(actions, ghostBird.uid)).toBe(false);

    restored.session.state.cards.find((card) => card.uid === target.uid)!.location = "graveyard";
    const noTargetActions = getLuaRestoreLegalActions(restored, 0);
    expect(hasDirectAttack(noTargetActions, ghostBird.uid)).toBe(false);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
