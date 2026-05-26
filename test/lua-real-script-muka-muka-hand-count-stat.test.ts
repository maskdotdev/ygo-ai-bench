import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Muka Muka hand-count stat", () => {
  it("restores GetFieldGroupCount hand-size ATK/DEF callbacks and recalculates battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mukaCode = "46657337";
    const handFillerA = "46657338";
    const handFillerB = "46657339";
    const handFillerC = "46657340";
    const defenderCode = "46657341";
    const script = workspace.readScript(`official/c${mukaCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.GetFieldGroupCount(c:GetControler(),LOCATION_HAND,0)*300");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mukaCode),
      { code: handFillerA, name: "Muka Muka Hand Filler A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: handFillerB, name: "Muka Muka Hand Filler B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: handFillerC, name: "Muka Muka Hand Filler C", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Muka Muka Defender", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 466, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mukaCode, handFillerA, handFillerB, handFillerC] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const muka = session.state.cards.find((card) => card.code === mukaCode);
    const fillerA = session.state.cards.find((card) => card.code === handFillerA);
    const fillerB = session.state.cards.find((card) => card.code === handFillerB);
    const fillerC = session.state.cards.find((card) => card.code === handFillerC);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(muka).toBeDefined();
    expect(fillerA).toBeDefined();
    expect(fillerB).toBeDefined();
    expect(fillerC).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, muka!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, fillerA!.uid, "hand", 0);
    moveDuelCard(session.state, fillerB!.uid, "hand", 0);
    moveDuelCard(session.state, fillerC!.uid, "hand", 0);
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1).position = "faceUpAttack";
    muka!.faceUp = true;
    defender!.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mukaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === muka!.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      luaValueDescriptor: effect.luaValueDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        code: 100,
        event: "continuous",
        id: "lua-1-100",
        luaValueDescriptor: "stat:controller-field-group-count:2:0:x300",
        range: ["monsterZone"],
        sourceUid: muka!.uid,
      },
      {
        code: 104,
        event: "continuous",
        id: "lua-2-104",
        luaValueDescriptor: "stat:controller-field-group-count:2:0:x300",
        range: ["monsterZone"],
        sourceUid: muka!.uid,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredMuka = restored.session.state.cards.find((card) => card.uid === muka!.uid)!;
    const restoredFillerA = restored.session.state.cards.find((card) => card.uid === fillerA!.uid)!;
    const restoredDefender = restored.session.state.cards.find((card) => card.uid === defender!.uid)!;
    expect(currentAttack(restoredMuka, restored.session.state)).toBe((muka!.data.attack ?? 0) + 900);
    expect(currentDefense(restoredMuka, restored.session.state)).toBe((muka!.data.defense ?? 0) + 900);

    moveDuelCard(restored.session.state, restoredFillerA.uid, "graveyard", 0);
    expect(currentAttack(restoredMuka, restored.session.state)).toBe((muka!.data.attack ?? 0) + 600);
    expect(currentDefense(restoredMuka, restored.session.state)).toBe((muka!.data.defense ?? 0) + 600);

    const attack = getLegalActions(restored.session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === muka!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(restored.session, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(currentAttack(restoredMuka, restored.session.state) - (defender!.data.attack ?? 0));
    expect(restored.session.state.players[1].lifePoints).toBe(8000 - restored.session.state.battleDamage[1]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: muka!.uid,
        eventPlayer: 1,
        eventValue: currentAttack(restoredMuka, restored.session.state) - (defender!.data.attack ?? 0),
        eventReason: duelReason.battle,
        eventReasonCardUid: muka!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === restoredDefender.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === restoredMuka.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
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
