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
const attributeEarth = 0x1;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Element Doom chain attack", () => {
  it("restores its attribute-gated battled trigger and reopens its attack with Duel.ChainAttack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const elementDoomCode = "23118924";
    const earthSupportCode = "2311";
    const windSupportCode = "2312";
    const firstTargetCode = "2313";
    const followupTargetCode = "2314";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === elementDoomCode),
      { code: earthSupportCode, name: "Element Doom EARTH Support", kind: "monster", typeFlags: 0x1, level: 4, attribute: attributeEarth, attack: 1000, defense: 1000 },
      { code: windSupportCode, name: "Element Doom WIND Support", kind: "monster", typeFlags: 0x1, level: 4, attribute: attributeWind, attack: 1000, defense: 1000 },
      { code: firstTargetCode, name: "Element Doom First Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: followupTargetCode, name: "Element Doom Followup Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 231, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [elementDoomCode, earthSupportCode, windSupportCode] }, 1: { main: [firstTargetCode, followupTargetCode] } });
    startDuel(session);

    const elementDoom = session.state.cards.find((card) => card.code === elementDoomCode);
    const earthSupport = session.state.cards.find((card) => card.code === earthSupportCode);
    const windSupport = session.state.cards.find((card) => card.code === windSupportCode);
    const firstTarget = session.state.cards.find((card) => card.code === firstTargetCode);
    const followupTarget = session.state.cards.find((card) => card.code === followupTargetCode);
    expect(elementDoom).toBeDefined();
    expect(earthSupport).toBeDefined();
    expect(windSupport).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(followupTarget).toBeDefined();
    moveDuelCard(session.state, elementDoom!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, earthSupport!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, windSupport!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, followupTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(elementDoomCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 1138, sourceUid: elementDoom!.uid }),
        expect.objectContaining({ event: "trigger", code: 1139, sourceUid: elementDoom!.uid }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === elementDoom!.uid && action.targetUid === firstTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({
      location: "graveyard",
      reasonCardUid: elementDoom!.uid,
    });
    expect(session.state.players[1].lifePoints).toBe(7500);
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "battleDestroyed",
        eventCardUid: elementDoom!.uid,
        eventPlayer: 1,
        sourceUid: elementDoom!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === elementDoom!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);

    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.attacksDeclared).not.toContain(elementDoom!.uid);
    expect(restored.session.state.waitingFor).toBe(0);
    expect(restored.session.state.cards.find((card) => card.uid === elementDoom!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === followupTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "declareAttack", attackerUid: elementDoom!.uid, targetUid: followupTarget!.uid }),
      ]),
    );
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
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
