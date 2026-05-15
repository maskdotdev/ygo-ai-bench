import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D - Force Plasma stat extra attack", () => {
  it("restores official graveyard-count ATK update and extra attack grant for Plasma", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dForceCode = "6186304";
    const plasmaCode = "83965310";
    const graveCodes = ["900000580", "900000581", "900000582"];
    const firstTargetCode = "900000583";
    const secondTargetCode = "900000584";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dForceCode || card.code === plasmaCode),
      ...graveCodes.map((code) => ({ code, name: `D Force Grave Probe ${code}`, kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 })),
      { code: firstTargetCode, name: "D Force First Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: secondTargetCode, name: "D Force Second Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6181, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dForceCode, plasmaCode, ...graveCodes] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const dForce = session.state.cards.find((card) => card.code === dForceCode);
    const plasma = session.state.cards.find((card) => card.code === plasmaCode);
    const firstTarget = session.state.cards.find((card) => card.code === firstTargetCode);
    const secondTarget = session.state.cards.find((card) => card.code === secondTargetCode);
    expect(dForce).toBeDefined();
    expect(plasma).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    moveDuelCard(session.state, dForce!.uid, "spellTrapZone", 0);
    dForce!.faceUp = true;
    moveDuelCard(session.state, plasma!.uid, "monsterZone", 0);
    plasma!.faceUp = true;
    plasma!.position = "faceUpAttack";
    for (const code of graveCodes) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "graveyard", 0);
    }
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1);
    firstTarget!.faceUp = true;
    firstTarget!.position = "faceUpAttack";
    moveDuelCard(session.state, secondTarget!.uid, "monsterZone", 1);
    secondTarget!.faceUp = true;
    secondTarget!.position = "faceUpAttack";
    session.state.turnPlayer = 0;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dForceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === dForce!.uid && [100, 194].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 100,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-100",
          "lifePointValue": [Function],
          "luaTargetDescriptor": "target:code:83965310",
          "luaTypeFlags": 2,
          "luaValueDescriptor": "stat:all-grave-monster-count-x100",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:6186304:lua-5-100",
          "sourceUid": "p0-deck-6186304-0",
          "statValue": [Function],
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            4,
            0,
          ],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "canActivate": [Function],
          "code": 194,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-7-194",
          "luaTargetDescriptor": "target:code:83965310",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:6186304:lua-7-194",
          "sourceUid": "p0-deck-6186304-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            4,
            0,
          ],
          "value": 1,
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredUpdate = restored.session.state.effects.find((effect) => effect.sourceUid === dForce!.uid && effect.code === 100);
    const statCtx = {
      duel: restored.session.state,
      source: restored.session.state.cards.find((card) => card.uid === dForce!.uid)!,
      player: 0 as const,
      targetUids: [],
      log: () => {},
      moveCard: () => {
        throw new Error("not used");
      },
      negateChainLink: () => false,
      setTargets: () => {},
      getTargets: () => [],
      setTargetPlayer: () => {},
      setTargetParam: () => {},
    };
    expect(restoredUpdate?.targetCardPredicate?.(statCtx, restored.session.state.cards.find((card) => card.uid === plasma!.uid)!)).toBe(true);
    expect(restoredUpdate?.statValue?.(statCtx, restored.session.state.cards.find((card) => card.uid === plasma!.uid)!)).toBe(300);

    const probe = restored.host.loadScript(
      `
      local plasma=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${plasmaCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("d force grave monsters " .. Duel.GetMatchingGroupCount(Card.IsMonster,0,LOCATION_GRAVE,LOCATION_GRAVE,nil))
      Debug.Message("d force plasma attack " .. plasma:GetAttack())
      `,
      "d-force-plasma-stat-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("d force grave monsters 3");
    expect(restored.host.messages).toContain("d force plasma attack 2200");

    const firstAttack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === plasma!.uid && action.targetUid === firstTarget!.uid,
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, firstAttack!);
    passBattleResponses(restored);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 });
    expect(restored.session.state.players[1].lifePoints).toBe(6800);
    expect(restored.session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "graveyard" });
    const secondActions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(secondActions, plasma!.uid, secondTarget!.uid)).toBe(true);
  });
});

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}
