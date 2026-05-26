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
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectExtraAttack = 194;
const eventChaining = 1027;

describe.skipIf(!hasUpstreamScripts)("Lua real script Combo Master chain extra attack", () => {
  it("restores its EVENT_CHAINING flag into a conditional extra Battle Phase attack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const comboMasterCode = "44800181";
    const comboMasterScript = workspace.readScript(`c${comboMasterCode}.lua`) ?? "";
    expect(comboMasterScript).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(comboMasterScript).toContain("Duel.GetCurrentChain()>1");
    const playerQuickCode = "44800182";
    const opponentQuickCode = "44800183";
    const targetCode = "44800184";
    const cards: DuelCardData[] = [
      { code: comboMasterCode, name: "Combo Master", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, attack: 2200, defense: 1500 },
      { code: playerQuickCode, name: "Combo Master Player Chain", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: opponentQuickCode, name: "Combo Master Opponent Chain", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Combo Master Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 500, defense: 500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [comboMasterCode, playerQuickCode] }, 1: { main: [opponentQuickCode, targetCode] } });
    startDuel(session);

    const comboMaster = session.state.cards.find((card) => card.code === comboMasterCode);
    const playerQuick = session.state.cards.find((card) => card.code === playerQuickCode);
    const opponentQuick = session.state.cards.find((card) => card.code === opponentQuickCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(comboMaster).toBeDefined();
    expect(playerQuick).toBeDefined();
    expect(opponentQuick).toBeDefined();
    expect(target).toBeDefined();
    moveFaceUpAttack(session, comboMaster!.uid, 0);
    moveDuelCard(session.state, playerQuick!.uid, "hand", 0);
    moveDuelCard(session.state, opponentQuick!.uid, "hand", 1);
    moveFaceUpAttack(session, target!.uid, 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${playerQuickCode}.lua`) return quickChainScript(playerQuickCode, "player quick resolved");
        if (name === `c${opponentQuickCode}.lua`) return quickChainScript(opponentQuickCode, "opponent quick resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(comboMasterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(playerQuickCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentQuickCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    expect(
      getLuaRestoreLegalActions(restoredSetup, 0).some((action) => action.type === "declareAttack" && action.attackerUid === comboMaster!.uid),
    ).toBe(false);
    expect(restoredSetup.session.state.effects.filter((effect) => effect.sourceUid === comboMaster!.uid)).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 1027,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-1027",
          "luaTypeFlags": 2050,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:44800181:lua-1-1027",
          "sourceUid": "p0-deck-44800181-0",
          "target": [Function],
        },
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
          "registryKey": "lua:44800181:lua-2-194",
          "sourceUid": "p0-deck-44800181-0",
          "target": [Function],
          "value": 1,
        },
      ]
    `);

    const playerChain = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "activateEffect" && action.uid === playerQuick!.uid,
    );
    expect(playerChain, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, playerChain!);
    expect(restoredSetup.session.state.flagEffects.filter((flag) => flag.ownerId === comboMaster!.uid && flag.code === Number(comboMasterCode))).toEqual([]);

    const opponentChain = getLuaRestoreLegalActions(restoredSetup, 1).find(
      (action) => action.type === "activateEffect" && action.uid === opponentQuick!.uid,
    );
    expect(opponentChain, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, opponentChain!);
    expect(restoredSetup.session.state.chain.map((link) => ({ effectId: link.effectId, sourceUid: link.sourceUid }))).toEqual([
      { effectId: "lua-3-1002", sourceUid: playerQuick!.uid },
      { effectId: "lua-4-1002", sourceUid: opponentQuick!.uid },
    ]);
    expect(restoredSetup.session.state.eventHistory.filter((event) => event.eventName === "chaining" && event.eventCode === eventChaining)).toEqual([
      {
        eventName: "chaining",
        eventCode: eventChaining,
        eventCardUid: playerQuick!.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "chaining",
        eventCode: eventChaining,
        eventCardUid: opponentQuick!.uid,
        eventPlayer: 1,
        eventValue: 2,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventChainDepth: 2,
        eventChainLinkId: "chain-4",
        relatedEffectId: 4,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredSetup.session.state.flagEffects.filter((flag) => flag.ownerId === comboMaster!.uid && flag.code === Number(comboMasterCode))).toEqual([
      {
        ownerType: "card",
        ownerId: comboMaster!.uid,
        code: Number(comboMasterCode),
        property: 0,
        reset: 0x41fe1200,
        resetCount: 1,
        turn: 2,
        value: 0,
      },
    ]);
    resolveRestoredChain(restoredSetup);
    expect(restoredSetup.host.messages).toEqual(["opponent quick resolved", "player quick resolved"]);

    const restoredFlag = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expectCleanRestore(restoredFlag);
    expectRestoredLegalActions(restoredFlag, 0);
    restoredFlag.session.state.phase = "battle";
    restoredFlag.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredFlag, 0);
    const firstAttack = getLuaRestoreLegalActions(restoredFlag, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === comboMaster!.uid && action.targetUid === target!.uid,
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredFlag, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlag, firstAttack!);
    passBattleResponses(restoredFlag);
    expect(restoredFlag.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredFlag.session.state.players[1].lifePoints).toBe(6300);

    const restoredExtraAttack = restoreDuelWithLuaScripts(serializeDuel(restoredFlag.session), source, reader);
    expectCleanRestore(restoredExtraAttack);
    expectRestoredLegalActions(restoredExtraAttack, 0);
    const secondActions = getLuaRestoreLegalActions(restoredExtraAttack, 0);
    expect(hasAttack(secondActions, comboMaster!.uid, target!.uid)).toBe(false);
    expect(hasDirectAttack(secondActions, comboMaster!.uid)).toBe(true);
  });
});

function quickChainScript(code: string, message: string): string {
  return `
    c${code}={}
    function c${code}.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function moveFaceUpAttack(session: ReturnType<typeof createDuel>, uid: string, player: 0 | 1): void {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  moveDuelCard(session.state, uid, "monsterZone", player);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
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
