import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Call of the Earthbound attack retarget", () => {
  it("restores Call of the Earthbound and changes the attack target to another legal monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const callCode = "65743242";
    const sevenToolsCode = "3819470";
    const attackerCode = "6574";
    const newTargetCode = "6575";
    const originalTargetCode = "6576";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === callCode || card.code === sevenToolsCode),
      { code: attackerCode, name: "Call of the Earthbound Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: newTargetCode, name: "Call of the Earthbound New Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 500 },
      { code: originalTargetCode, name: "Call of the Earthbound Original Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 657, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode, sevenToolsCode] }, 1: { main: [callCode, newTargetCode, originalTargetCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const sevenTools = session.state.cards.find((card) => card.code === sevenToolsCode);
    const call = session.state.cards.find((card) => card.code === callCode);
    const newTarget = session.state.cards.find((card) => card.code === newTargetCode);
    const originalTarget = session.state.cards.find((card) => card.code === originalTargetCode);
    expect(attacker).toBeDefined();
    expect(sevenTools).toBeDefined();
    expect(call).toBeDefined();
    expect(newTarget).toBeDefined();
    expect(originalTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, sevenTools!.uid, "spellTrapZone", 0);
    sevenTools!.faceUp = false;
    sevenTools!.position = "faceDown";
    moveDuelCard(session.state, newTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, call!.uid, "spellTrapZone", 1);
    call!.faceUp = false;
    call!.position = "faceDown";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(callCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(sevenToolsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === originalTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 0) {
      const turnPlayerPass = getLegalActions(session, 0).find((action) => action.type === "passAttack");
      expect(turnPlayerPass).toBeDefined();
      applyAndAssert(session, turnPlayerPass!);
    }

    const callAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === call!.uid);
    expect(callAction).toBeDefined();
    applyAndAssert(session, callAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: originalTarget!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === sevenTools!.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: newTarget!.uid });
    expect(restored.session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: newTarget!.uid });
    expect(restored.session.state.cards.find((card) => card.uid === originalTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === call!.uid)).toMatchObject({ location: "graveyard", controller: 1 });

    passBattleResponses(restored.session);
    expect(restored.session.state.cards.find((card) => card.uid === originalTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === newTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.players[1].lifePoints).toBe(6700);
    expect(restored.session.state.battleDamage).toMatchObject({ 1: 1300 });
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
