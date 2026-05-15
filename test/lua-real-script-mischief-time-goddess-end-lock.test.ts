import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setValkyrie = 0x122;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mischief of the Time Goddess End Phase lock", () => {
  it("restores its official temporary EFFECT_CANNOT_EP lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mischiefCode = "92182447";
    const valkyrieCode = "92182448";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mischiefCode),
      { code: valkyrieCode, name: "Mischief Valkyrie Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setValkyrie] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 921, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mischiefCode, valkyrieCode] }, 1: { main: [] } });
    startDuel(session);

    const mischief = requireCard(session, mischiefCode);
    const valkyrie = requireCard(session, valkyrieCode);
    moveDuelCard(session.state, mischief.uid, "hand", 0);
    moveDuelCard(session.state, valkyrie.uid, "monsterZone", 0);
    valkyrie.faceUp = true;
    valkyrie.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;
    session.state.attacksDeclared = [valkyrie.uid];

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mischiefCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const activate = getDuelLegalActions(session, 0).find((action) => "uid" in action && action.uid === mischief.uid);
    expect(activate, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyActionAndAssert(session, activate!);
    passChainUntilOpen(session);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: mischief.uid,
          code: 187,
          controller: 0,
          targetRange: [1, 0],
          reset: { flags: 0x50000004 },
        }),
      ]),
    );
    session.state.effects = session.state.effects.filter((effect) => effect.sourceUid === mischief.uid && effect.code === 187);
    session.state.phase = "main2";
    session.state.waitingFor = 0;

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(actions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "end" })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "endTurn" })]));
  });

  it("restores its official rest-of-battle opponent activation lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mischiefCode = "92182447";
    const valkyrieCode = "92182448";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mischiefCode),
      { code: valkyrieCode, name: "Mischief Valkyrie Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setValkyrie] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 922, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mischiefCode, valkyrieCode] }, 1: { main: [] } });
    startDuel(session);

    const mischief = requireCard(session, mischiefCode);
    const valkyrie = requireCard(session, valkyrieCode);
    moveDuelCard(session.state, mischief.uid, "hand", 0);
    moveDuelCard(session.state, valkyrie.uid, "monsterZone", 0);
    valkyrie.faceUp = true;
    valkyrie.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;
    session.state.attacksDeclared = [valkyrie.uid];

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mischiefCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const activate = getDuelLegalActions(session, 0).find((action) => "uid" in action && action.uid === mischief.uid);
    expect(activate, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyActionAndAssert(session, activate!);
    passChainUntilOpen(session);
    const lock = session.state.effects.find((effect) => effect.sourceUid === mischief.uid && effect.code === 6 && effect.value === 1);
    expect(lock).toMatchObject({ targetRange: [0, 1], reset: { flags: 0x40000280 } });
    session.state.effects = session.state.effects.filter((effect) => effect === lock);
    session.state.waitingFor = 1;

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 1),
    );
    expect(restored.session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ sourceUid: mischief.uid, code: 6, value: 1, reset: { flags: 0x40000280 } })]));
  });

  it("restores its official same-code activation oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mischiefCode = "92182447";
    const valkyrieCode = "92182448";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mischiefCode),
      { code: valkyrieCode, name: "Mischief Valkyrie Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setValkyrie] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 923, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mischiefCode, mischiefCode, valkyrieCode] }, 1: { main: [] } });
    startDuel(session);

    const [firstMischief, secondMischief] = session.state.cards.filter((card) => card.code === mischiefCode);
    const valkyrie = requireCard(session, valkyrieCode);
    expect(firstMischief).toBeDefined();
    expect(secondMischief).toBeDefined();
    moveDuelCard(session.state, firstMischief!.uid, "hand", 0);
    moveDuelCard(session.state, secondMischief!.uid, "hand", 0);
    moveDuelCard(session.state, valkyrie.uid, "monsterZone", 0);
    valkyrie.faceUp = true;
    valkyrie.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;
    session.state.attacksDeclared = [valkyrie.uid];

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mischiefCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const activate = getDuelLegalActions(session, 0).find((action) => "uid" in action && action.uid === firstMischief!.uid);
    expect(activate, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyActionAndAssert(session, activate!);
    passChainUntilOpen(session);
    const oath = session.state.effects.find((effect) => effect.sourceUid === firstMischief!.uid && effect.code === 6 && effect.value === undefined && effect.reset?.count === 3);
    expect(oath).toMatchObject({ targetRange: [1, 0], reset: { flags: 0x40000200, count: 3 } });
    session.state.effects = session.state.effects.filter((effect) => effect === oath || effect.sourceUid === secondMischief!.uid);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(actions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", uid: secondMischief!.uid })]));
  });

  it("restores its official opponent turn skip lock as an end-turn-only window", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mischiefCode = "92182447";
    const valkyrieCode = "92182448";
    const opponentMonsterCode = "92182450";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mischiefCode),
      { code: valkyrieCode, name: "Mischief Valkyrie Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setValkyrie] },
      { code: opponentMonsterCode, name: "Mischief Opponent Normal", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 924, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mischiefCode, valkyrieCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const mischief = requireCard(session, mischiefCode);
    const valkyrie = requireCard(session, valkyrieCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, mischief.uid, "hand", 0);
    moveDuelCard(session.state, valkyrie.uid, "monsterZone", 0);
    valkyrie.faceUp = true;
    valkyrie.position = "faceUpAttack";
    moveDuelCard(session.state, opponentMonster.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;
    session.state.attacksDeclared = [valkyrie.uid];

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mischiefCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const activate = getDuelLegalActions(session, 0).find((action) => "uid" in action && action.uid === mischief.uid);
    expect(activate, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyActionAndAssert(session, activate!);
    passChainUntilOpen(session);
    const skipTurn = session.state.effects.find((effect) => effect.sourceUid === mischief.uid && effect.code === 188);
    expect(skipTurn).toMatchObject({ targetRange: [0, 1], reset: { flags: 0x60000200 } });
    session.state.effects = session.state.effects.filter((effect) => effect === skipTurn);
    applyActionAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "endTurn"));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state).toMatchObject({ turnPlayer: 1, phase: "main1", waitingFor: 1 });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 1),
    );
    const actions = getLuaRestoreLegalActions(restored, 1);
    expect(actions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(actions).toEqual([expect.objectContaining({ type: "endTurn", player: 1 })]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passChainUntilOpen(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "passChain"));
  }
}

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
