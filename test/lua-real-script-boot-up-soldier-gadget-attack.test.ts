import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const setGadget = 0x51;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Boot-Up Soldier Gadget attack", () => {
  it("restores aux.FaceupFilter SetCard conditional single-range ATK updates into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bootUpSoldierCode = "13316346";
    const gadgetAllyCode = "133163461";
    const opponentTargetCode = "133163462";
    const script = workspace.readScript(`official/c${bootUpSoldierCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
    expect(script).toContain("return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_GADGET),e:GetHandlerPlayer(),LOCATION_MZONE,0,1,nil)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bootUpSoldierCode),
      { code: gadgetAllyCode, name: "Boot-Up Soldier Gadget Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setGadget] },
      { code: opponentTargetCode, name: "Boot-Up Soldier Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1331, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bootUpSoldierCode, gadgetAllyCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const bootUpSoldier = session.state.cards.find((card) => card.code === bootUpSoldierCode);
    const gadgetAlly = session.state.cards.find((card) => card.code === gadgetAllyCode);
    const opponentTarget = session.state.cards.find((card) => card.code === opponentTargetCode);
    expect(bootUpSoldier).toBeDefined();
    expect(gadgetAlly).toBeDefined();
    expect(opponentTarget).toBeDefined();
    moveDuelCard(session.state, bootUpSoldier!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, gadgetAlly!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bootUpSoldierCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === bootUpSoldier!.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      luaTypeFlags: effect.luaTypeFlags,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        luaConditionDescriptor: "condition:controller-has-faceup-setcode:81",
        luaTypeFlags: 1,
        property: 0x20000,
        range: ["monsterZone"],
        sourceUid: bootUpSoldier!.uid,
        value: 2000,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const restoredBootUpSoldier = restored.session.state.cards.find((card) => card.uid === bootUpSoldier!.uid)!;
    const restoredGadgetAlly = restored.session.state.cards.find((card) => card.uid === gadgetAlly!.uid)!;
    expect(currentAttack(restoredBootUpSoldier, restored.session.state)).toBe((bootUpSoldier!.data.attack ?? 0) + 2000);
    moveDuelCard(restored.session.state, restoredGadgetAlly.uid, "graveyard", 0);
    expect(currentAttack(restoredBootUpSoldier, restored.session.state)).toBe(bootUpSoldier!.data.attack ?? 0);
    moveDuelCard(restored.session.state, restoredGadgetAlly.uid, "monsterZone", 0).position = "faceUpAttack";
    restoredGadgetAlly.faceUp = true;
    expect(currentAttack(restoredBootUpSoldier, restored.session.state)).toBe((bootUpSoldier!.data.attack ?? 0) + 2000);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === bootUpSoldier!.uid && action.targetUid === opponentTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restored.session.state.players[1].lifePoints).toBe(7500);
    expect(restored.session.state.cards.find((card) => card.uid === opponentTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === bootUpSoldier!.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

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
