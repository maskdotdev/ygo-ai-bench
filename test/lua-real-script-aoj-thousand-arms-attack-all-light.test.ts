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
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ally of Justice Thousand Arms attack-all LIGHT", () => {
  it("restores its target-filtered attack-all effect for spent attackers", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const thousandArmsCode = "85876417";
    const lightTargetCode = "85876418";
    const darkTargetCode = "85876419";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === thousandArmsCode),
      { code: lightTargetCode, name: "Thousand Arms LIGHT Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000, attribute: attributeLight },
      { code: darkTargetCode, name: "Thousand Arms DARK Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000, attribute: attributeDark },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8587, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [thousandArmsCode] }, 1: { main: [lightTargetCode, darkTargetCode] } });
    startDuel(session);

    const thousandArms = requireCard(session, thousandArmsCode);
    const lightTarget = requireCard(session, lightTargetCode);
    const darkTarget = requireCard(session, darkTargetCode);
    moveFaceUpAttack(session, thousandArms, 0);
    moveFaceUpAttack(session, lightTarget, 1);
    moveFaceUpAttack(session, darkTarget, 1);
    session.state.attacksDeclared.push(thousandArms.uid);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thousandArmsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 193, sourceUid: thousandArms.uid })]),
    );
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, thousandArms.uid, lightTarget.uid)).toBe(true);
    expect(hasAttack(actions, thousandArms.uid, darkTarget.uid)).toBe(false);
    expect(hasDirectAttack(actions, thousandArms.uid)).toBe(false);
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
