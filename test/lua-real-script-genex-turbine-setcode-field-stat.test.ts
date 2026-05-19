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
const setGenex = 0x2;
const setGenexAlly = 0x2002;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Genex Turbine setcode field stat", () => {
  it("restores aux.TargetBoolFunction Card.IsSetCard field ATK updates into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const genexTurbineCode = "52222372";
    const genexAllyAttackerCode = "522223721";
    const ownNonGenexCode = "522223722";
    const opponentGenexCode = "522223723";
    const script = workspace.readScript(`c${genexTurbineCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_GENEX))");
    expect(script).toContain("e1:SetValue(400)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === genexTurbineCode),
      { code: genexAllyAttackerCode, name: "Genex Turbine Ally Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000, setcodes: [setGenexAlly] },
      { code: ownNonGenexCode, name: "Genex Turbine Non-Genex", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentGenexCode, name: "Genex Turbine Opponent Genex", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000, setcodes: [setGenex] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5222, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [genexTurbineCode, genexAllyAttackerCode, ownNonGenexCode] }, 1: { main: [opponentGenexCode] } });
    startDuel(session);

    const genexTurbine = session.state.cards.find((card) => card.code === genexTurbineCode);
    const genexAllyAttacker = session.state.cards.find((card) => card.code === genexAllyAttackerCode);
    const ownNonGenex = session.state.cards.find((card) => card.code === ownNonGenexCode);
    const opponentGenex = session.state.cards.find((card) => card.code === opponentGenexCode);
    expect(genexTurbine).toBeDefined();
    expect(genexAllyAttacker).toBeDefined();
    expect(ownNonGenex).toBeDefined();
    expect(opponentGenex).toBeDefined();
    moveDuelCard(session.state, genexTurbine!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, genexAllyAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ownNonGenex!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentGenex!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(genexTurbineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === genexTurbine!.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      id: effect.id,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        id: "lua-1-100",
        luaTargetDescriptor: "target:setcode:2",
        range: ["monsterZone"],
        sourceUid: genexTurbine!.uid,
        targetRange: [4, 0],
        value: 400,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const restoredGenexAllyAttacker = restored.session.state.cards.find((card) => card.uid === genexAllyAttacker!.uid)!;
    const restoredOwnNonGenex = restored.session.state.cards.find((card) => card.uid === ownNonGenex!.uid)!;
    const restoredOpponentGenex = restored.session.state.cards.find((card) => card.uid === opponentGenex!.uid)!;
    expect(currentAttack(restoredGenexAllyAttacker, restored.session.state)).toBe(1500);
    expect(currentAttack(restoredOwnNonGenex, restored.session.state)).toBe(1000);
    expect(currentAttack(restoredOpponentGenex, restored.session.state)).toBe(1200);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === genexAllyAttacker!.uid && action.targetUid === opponentGenex!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(300);
    expect(restored.session.state.players[1].lifePoints).toBe(7700);
    expect(restored.session.state.cards.find((card) => card.uid === opponentGenex!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === genexAllyAttacker!.uid)).toMatchObject({ location: "monsterZone" });
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
