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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Neo Flamvell Sabre opponent-grave-count stat", () => {
  it("restores thresholded GetFieldGroupCount opponent Graveyard ATK callback into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sabreCode = "91554542";
    const defenderCode = "915545420";
    const fillerCodes = Array.from({ length: 8 }, (_, index) => `91554543${index}`);
    const script = workspace.readScript(`official/c${sabreCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("local gct=Duel.GetFieldGroupCount(e:GetHandler():GetControler(),0,LOCATION_GRAVE)");
    expect(script).toContain("if gct<=4 then return 600");
    expect(script).toContain("elseif gct>=8 then return -300");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sabreCode),
      ...fillerCodes.map((code, index) => ({ code, name: `Neo Flamvell Sabre Opponent Grave Filler ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 })),
      { code: defenderCode, name: "Neo Flamvell Sabre Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1900, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const low = createSabreBattle({ sabreCode, defenderCode, fillerCodes, cards, graveCount: 3, seed: 9155 });
    registerSabre(low.session, workspace, sabreCode);
    expect(low.session.state.effects.filter((effect) => effect.sourceUid === low.sabre.uid).map((effect) => ({
      code: effect.code,
      id: effect.id,
      luaValueDescriptor: effect.luaValueDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        code: 100,
        id: "lua-1-100",
        luaValueDescriptor: "stat:controller-field-group-count-threshold:0:16:lte4:600:gte8:-300:else0",
        range: ["monsterZone"],
        sourceUid: low.sabre.uid,
      },
    ]);
    expect(currentAttack(low.sabre, low.session.state)).toBe((low.sabre.data.attack ?? 0) + 600);
    const restoredLow = restoreDuelWithLuaScripts(serializeDuel(low.session), workspace, reader);
    expectCleanRestore(restoredLow);
    const restoredLowSabre = restoredLow.session.state.cards.find((card) => card.uid === low.sabre.uid)!;
    expect(currentAttack(restoredLowSabre, restoredLow.session.state)).toBe((low.sabre.data.attack ?? 0) + 600);
    declareAndPassRestoredBattle(restoredLow, low.sabre.uid, low.defender.uid);
    expect(restoredLow.session.state.battleDamage).toEqual({ 0: 0, 1: 200 });
    expect(restoredLow.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredLow.session.state.cards.find((card) => card.uid === low.defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });

    const middle = createSabreBattle({ sabreCode, defenderCode, fillerCodes, cards, graveCount: 5, seed: 9156 });
    registerSabre(middle.session, workspace, sabreCode);
    const restoredMiddle = restoreDuelWithLuaScripts(serializeDuel(middle.session), workspace, reader);
    expectCleanRestore(restoredMiddle);
    expect(currentAttack(restoredMiddle.session.state.cards.find((card) => card.uid === middle.sabre.uid)!, restoredMiddle.session.state)).toBe(middle.sabre.data.attack ?? 0);

    const high = createSabreBattle({ sabreCode, defenderCode, fillerCodes, cards, graveCount: 8, seed: 9157 });
    registerSabre(high.session, workspace, sabreCode);
    const restoredHigh = restoreDuelWithLuaScripts(serializeDuel(high.session), workspace, reader);
    expectCleanRestore(restoredHigh);
    expect(currentAttack(restoredHigh.session.state.cards.find((card) => card.uid === high.sabre.uid)!, restoredHigh.session.state)).toBe((high.sabre.data.attack ?? 0) - 300);
  });
});

function createSabreBattle(args: { sabreCode: string; defenderCode: string; fillerCodes: string[]; cards: DuelCardData[]; graveCount: number; seed: number }) {
  const reader = createCardReader(args.cards);
  const session = createDuel({ seed: args.seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [args.sabreCode] }, 1: { main: [args.defenderCode, ...args.fillerCodes] } });
  startDuel(session);
  const sabre = session.state.cards.find((card) => card.code === args.sabreCode)!;
  const defender = session.state.cards.find((card) => card.code === args.defenderCode)!;
  moveDuelCard(session.state, sabre.uid, "monsterZone", 0).position = "faceUpAttack";
  sabre.faceUp = true;
  moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
  defender.faceUp = true;
  for (const filler of session.state.cards.filter((card) => args.fillerCodes.includes(card.code)).slice(0, args.graveCount)) {
    moveDuelCard(session.state, filler.uid, "graveyard", 1);
  }
  session.state.phase = "battle";
  session.state.waitingFor = 0;
  return { session, sabre, defender };
}

function registerSabre(session: DuelSession, workspace: UpstreamNodeWorkspace, code: string): void {
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
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer)).toEqual(getGroupedDuelLegalActions(restored.session, restored.session.state.waitingFor ?? restored.session.state.turnPlayer));
  expect(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer));
}

function applyRestoredAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
