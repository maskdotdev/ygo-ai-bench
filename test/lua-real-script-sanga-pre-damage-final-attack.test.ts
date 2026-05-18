import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sanga pre-damage final ATK", () => {
  it("restores optional pre-damage calculation final-ATK Quick Effect activation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sangaCode = "25955164";
    const attackerCode = "25955165";
    const script = workspace.readScript(`official/c${sangaCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_NO_TURN_RESET)");
    expect(script).toContain("Duel.GetAttackTarget()==e:GetHandler()");
    expect(script).toContain("Duel.SetTargetCard(Duel.GetAttacker())");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sangaCode),
      { code: attackerCode, name: "Sanga Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2595, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [sangaCode] } });
    startDuel(session);

    const attacker = requireCard(session, attackerCode);
    const sanga = requireCard(session, sangaCode);
    moveFaceUpAttack(session, attacker, 0);
    moveFaceUpAttack(session, sanga, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sangaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === sanga.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        category: 0x200000,
        code: 1134,
        event: "quick",
        id: "lua-1-1134",
        property: 0x400000,
        range: ["monsterZone"],
        sourceUid: sanga.uid,
      },
    ]);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === sanga.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);

    advanceToRestoredSangaActivation(restoredSetup, sanga.uid);
    expect(restoredSetup.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restoredSetup.session.state.waitingFor).toBe(1);
    expect(currentAttack(restoredSetup.session.state.cards.find((card) => card.uid === attacker.uid), restoredSetup.session.state)).toBe(3000);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 1);
    const sangaAction = getLuaRestoreLegalActions(restoredActivation, 1).find((action) => action.type === "activateEffect" && action.uid === sanga.uid);
    expect(sangaAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, sangaAction!);
    expect(restoredActivation.session.state.chain).toHaveLength(0);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 102 && effect.sourceUid === attacker.uid)).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 102,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-102",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:25955165:lua-2-102",
          "reset": {
            "flags": 1073741888,
          },
          "sourceUid": "p0-deck-25955165-0",
          "target": [Function],
          "value": 0,
        },
      ]
    `);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid), restoredActivation.session.state)).toBe(0);

    const restoredFinalAttack = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredFinalAttack);
    expect(currentAttack(restoredFinalAttack.session.state.cards.find((card) => card.uid === attacker.uid), restoredFinalAttack.session.state)).toBe(0);
    passRestoredBattleResponses(restoredFinalAttack);
    expect(restoredFinalAttack.session.state.battleDamage).toEqual({ 0: sanga.data.attack, 1: 0 });
    expect(restoredFinalAttack.session.state.players[0].lifePoints).toBe(8000 - (sanga.data.attack ?? 0));
    expect(restoredFinalAttack.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredFinalAttack.session.state.cards.find((card) => card.uid === sanga.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });
});

function advanceToRestoredSangaActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, sangaUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer).some((action) => action.type === "activateEffect" && action.uid === sangaUid)) {
    expect(++guard).toBeLessThan(20);
    expect(restored.session.state.pendingBattle).toBeDefined();
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
