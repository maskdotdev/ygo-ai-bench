import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import type { UpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceMachine = 0x20;
const racePlant = 0x100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Perfect Machine King race-count stat", () => {
  it("restores face-up Machine GetMatchingGroupCount ATK callback with handler exclusion into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const perfectKingCode = "18891691";
    const ownMachineCode = "188916910";
    const opponentMachineCode = "188916911";
    const facedownMachineCode = "188916912";
    const defenderCode = "188916913";
    const script = workspace.readScript(`official/c${perfectKingCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_MACHINE),c:GetControler(),LOCATION_MZONE,LOCATION_MZONE,e:GetHandler())*500");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === perfectKingCode),
      { code: ownMachineCode, name: "Perfect Machine King Own Machine", kind: "monster", typeFlags: typeMonster, race: raceMachine, level: 4, attack: 1000, defense: 1000 },
      { code: opponentMachineCode, name: "Perfect Machine King Opponent Machine", kind: "monster", typeFlags: typeMonster, race: raceMachine, level: 4, attack: 1000, defense: 1000 },
      { code: facedownMachineCode, name: "Perfect Machine King Facedown Machine", kind: "monster", typeFlags: typeMonster, race: raceMachine, level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Perfect Machine King Plant Defender", kind: "monster", typeFlags: typeMonster, race: racePlant, level: 4, attack: 3000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1889, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [perfectKingCode, ownMachineCode, facedownMachineCode] }, 1: { main: [opponentMachineCode, defenderCode] } });
    startDuel(session);

    const perfectKing = session.state.cards.find((card) => card.code === perfectKingCode)!;
    const ownMachine = session.state.cards.find((card) => card.code === ownMachineCode)!;
    const opponentMachine = session.state.cards.find((card) => card.code === opponentMachineCode)!;
    const facedownMachine = session.state.cards.find((card) => card.code === facedownMachineCode)!;
    const defender = session.state.cards.find((card) => card.code === defenderCode)!;
    moveDuelCard(session.state, perfectKing.uid, "monsterZone", 0).position = "faceUpAttack";
    perfectKing.faceUp = true;
    moveDuelCard(session.state, ownMachine.uid, "monsterZone", 0).position = "faceUpAttack";
    ownMachine.faceUp = true;
    moveDuelCard(session.state, facedownMachine.uid, "monsterZone", 0).position = "faceDownDefense";
    facedownMachine.faceUp = false;
    moveDuelCard(session.state, opponentMachine.uid, "monsterZone", 1).position = "faceUpAttack";
    opponentMachine.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    registerPerfectKing(session, workspace, perfectKingCode);
    expect(session.state.effects.filter((effect) => effect.sourceUid === perfectKing.uid).map((effect) => ({
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
        luaValueDescriptor: "stat:matching-faceup-race-count:controller:4:4:exclude-handler:32:x500",
        range: ["monsterZone"],
        sourceUid: perfectKing.uid,
      },
    ]);
    expect(currentAttack(perfectKing, session.state)).toBe((perfectKing.data.attack ?? 0) + 1000);
    facedownMachine.faceUp = true;
    expect(currentAttack(perfectKing, session.state)).toBe((perfectKing.data.attack ?? 0) + 1500);
    facedownMachine.faceUp = false;

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    const restoredPerfectKing = restored.session.state.cards.find((card) => card.uid === perfectKing.uid)!;
    expect(currentAttack(restoredPerfectKing, restored.session.state)).toBe((perfectKing.data.attack ?? 0) + 1000);

    declareAndPassRestoredBattle(restored, perfectKing.uid, defender.uid);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 700 });
    expect(restored.session.state.players[1].lifePoints).toBe(7300);
    expect(restored.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
  });
});

function registerPerfectKing(session: DuelSession, workspace: UpstreamNodeWorkspace, code: string): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function declareAndPassRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer).find(
    (action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid,
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer), null, 2)).toBeDefined();
  applyRestoredAndAssert(restored, attack!);
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAndAssert(restored, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
