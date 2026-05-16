import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mataza control extra attack", () => {
  it("restores official control-change lock and static extra attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const matazaCode = "22609617";
    const targetCode = "22609618";
    const opponentCode = "22609619";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === matazaCode),
      { code: targetCode, name: "Mataza Extra Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 500, defense: 500 },
      { code: opponentCode, name: "Mataza Swap Probe Opponent", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2260, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [matazaCode] }, 1: { main: [targetCode, opponentCode] } });
    startDuel(session);

    const mataza = session.state.cards.find((card) => card.code === matazaCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const opponent = session.state.cards.find((card) => card.code === opponentCode);
    expect(mataza).toBeDefined();
    expect(target).toBeDefined();
    expect(opponent).toBeDefined();
    moveFaceUpAttack(session, mataza!.uid, 0);
    moveFaceUpAttack(session, target!.uid, 1);
    moveFaceUpAttack(session, opponent!.uid, 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(matazaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    expect(restoredSetup.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 5 && effect.sourceUid === mataza!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 5,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-5",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "property": 131072,
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:22609617:lua-1-5",
        "sourceUid": "p0-deck-22609617-0",
        "target": [Function],
      }
    `);
    expect(restoredSetup.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 194 && effect.sourceUid === mataza!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 194,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-194",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:22609617:lua-2-194",
        "sourceUid": "p0-deck-22609617-0",
        "target": [Function],
        "value": 1,
      }
    `);

    const controlProbe = restoredSetup.host.loadScript(controlProbeScript(matazaCode, opponentCode), "mataza-control-probe.lua");
    expect(controlProbe.ok, controlProbe.error).toBe(true);
    expect(restoredSetup.host.messages).toContain("mataza control predicate false");
    expect(restoredSetup.host.messages).toContain("mataza control take 0");
    expect(restoredSetup.host.messages).toContain("mataza control swap false");
    expect(restoredSetup.session.state.cards.find((card) => card.uid === mataza!.uid)).toMatchObject({ controller: 0 });
    expect(restoredSetup.session.state.cards.find((card) => card.uid === mataza!.uid)!.previousController).toBe(0);

    const firstAttack = getLuaRestoreLegalActions(restoredSetup, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === mataza!.uid && action.targetUid === target!.uid
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, firstAttack!);
    passBattleResponses(restoredSetup);
    expect(restoredSetup.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredSetup.session.state.players[1].lifePoints).toBe(7200);

    moveDuelCard(restoredSetup.session.state, opponent!.uid, "graveyard", 1);
    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expectCleanRestore(restoredSecondAttack);
    expectRestoredLegalActions(restoredSecondAttack, 0);
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    expect(hasAttack(secondActions, mataza!.uid, target!.uid)).toBe(false);
    expect(hasDirectAttack(secondActions, mataza!.uid)).toBe(true);
  });
});

function moveFaceUpAttack(session: ReturnType<typeof createDuel>, uid: string, player: 0 | 1): void {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  moveDuelCard(session.state, uid, "monsterZone", player);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

function controlProbeScript(matazaCode: string, opponentCode: string): string {
  return `
    local mataza=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${matazaCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
    local opponent=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${opponentCode}), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
    Debug.Message("mataza control predicate " .. tostring(mataza:IsAbleToChangeControler()))
    Debug.Message("mataza control take " .. Duel.GetControl(mataza, 1, 0, 0, LOCATION_MZONE))
    Debug.Message("mataza control swap " .. tostring(Duel.SwapControl(mataza, opponent)))
  `;
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true && action.targetUid === undefined);
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
