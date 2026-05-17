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
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typePendulumMonster = 0x1000001;
const effectTypeActivate = 0x10;
const effectSummonProcedureGroup = 320;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pendulum AddProcedure reg=false", () => {
  it("restores AddProcedure(c,false) without exposing a hand-to-scale activation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oddEyesVenomCode = "45014450";
    const highScaleCode = "45014451";
    const candidateCode = "45014452";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === oddEyesVenomCode),
      { code: highScaleCode, name: "No Scale Activation High Scale Fixture", kind: "monster", typeFlags: typePendulumMonster, level: 4, leftScale: 8, rightScale: 8 },
      { code: candidateCode, name: "No Scale Activation Pendulum Candidate Fixture", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 450, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [highScaleCode, candidateCode], extra: [oddEyesVenomCode] }, 1: { main: [] } });
    startDuel(session);

    const oddEyesVenom = session.state.cards.find((card) => card.code === oddEyesVenomCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const candidate = session.state.cards.find((card) => card.code === candidateCode);
    expect(oddEyesVenom).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();

    moveDuelCard(session.state, oddEyesVenom!.uid, "hand", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, candidate!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(oddEyesVenomCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredHandWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredHandWindow.restoreComplete, restoredHandWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredHandWindow.missingRegistryKeys).toEqual([]);
    expect(restoredHandWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredHandWindow, 0);
    assertLegalActions(restoredHandWindow);
    expect(findPendulumScaleActivation(restoredHandWindow.session, getLuaRestoreLegalActions(restoredHandWindow, 0), oddEyesVenom!.uid)).toBeUndefined();
    expect(restoredHandWindow.session.state.effects.filter((effect) => effect.sourceUid === oddEyesVenom!.uid && effect.description === 1160)).toEqual([]);
    const restoredProcedureEffects = restoredHandWindow.session.state.effects.filter((effect) => effect.sourceUid === oddEyesVenom!.uid && effect.code === effectSummonProcedureGroup);
    expect(restoredProcedureEffects).toEqual([
      expect.objectContaining({
        sourceUid: oddEyesVenom!.uid,
        code: effectSummonProcedureGroup,
        description: 1163,
      }),
    ]);

    moveDuelCard(restoredHandWindow.session.state, oddEyesVenom!.uid, "spellTrapZone", 0);
    const restoredPendulumWindow = restoreDuelWithLuaScripts(serializeDuel(restoredHandWindow.session), workspace, reader);
    expect(restoredPendulumWindow.restoreComplete, restoredPendulumWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendulumWindow.missingRegistryKeys).toEqual([]);
    expect(restoredPendulumWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPendulumWindow, 0);
    assertLegalActions(restoredPendulumWindow);
    expect(restoredPendulumWindow.session.state.effects.filter((effect) => effect.sourceUid === oddEyesVenom!.uid && effect.description === 1160)).toEqual([]);
    const pendulumSummon = getLuaRestoreLegalActions(restoredPendulumWindow, 0).find(
      (action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid),
    );
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredPendulumWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPendulumWindow, { ...pendulumSummon!, summonUids: [candidate!.uid] });
    expect(restoredPendulumWindow.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "pendulum",
      faceUp: true,
    });
    expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false);
  });
});

function findPendulumScaleActivation(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.description === 1160 && ((effect.luaTypeFlags ?? 0) & effectTypeActivate) !== 0;
  });
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertLegalActions(restored);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function assertLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
