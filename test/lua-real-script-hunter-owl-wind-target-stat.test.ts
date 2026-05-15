import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hunter Owl WIND target and stat lock", () => {
  it("restores its WIND ally battle-target lock and dynamic ATK update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hunterOwlCode = "51962254";
    const windAllyCode = "51962255";
    const openTargetCode = "51962256";
    const attackerCode = "51962257";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hunterOwlCode),
      { code: windAllyCode, name: "Hunter Owl WIND Ally", kind: "monster", typeFlags: 0x1, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
      { code: openTargetCode, name: "Hunter Owl Open Target", kind: "monster", typeFlags: 0x1, attribute: 0x1, level: 4, attack: 900, defense: 1000 },
      { code: attackerCode, name: "Hunter Owl Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5196, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [hunterOwlCode, windAllyCode, openTargetCode] } });
    startDuel(session);

    const attacker = requireCard(session, attackerCode);
    const hunterOwl = requireCard(session, hunterOwlCode);
    const windAlly = requireCard(session, windAllyCode);
    const openTarget = requireCard(session, openTargetCode);
    moveFaceUpAttack(session, attacker, 0);
    moveFaceUpAttack(session, hunterOwl, 1);
    moveFaceUpAttack(session, windAlly, 1);
    moveFaceUpAttack(session, openTarget, 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hunterOwlCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentAttack(hunterOwl, session.state)).toBe((hunterOwl.data.attack ?? 0) + 1000);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === hunterOwl.uid && [70, 100].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 70,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-70",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:51962254:lua-1-70",
          "sourceUid": "p1-deck-51962254-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 100,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-100",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:51962254:lua-2-100",
          "sourceUid": "p1-deck-51962254-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, attacker.uid, hunterOwl.uid)).toBe(false);
    expect(hasAttack(actions, attacker.uid, windAlly.uid)).toBe(true);
    expect(hasAttack(actions, attacker.uid, openTarget.uid)).toBe(true);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === hunterOwl.uid), restored.session.state)).toBe((hunterOwl.data.attack ?? 0) + 1000);

    const probe = restored.host.loadScript(attackProbeScript(hunterOwlCode), "hunter-owl-wind-target-stat-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain(`hunter owl target/stat protected/${(hunterOwl.data.attack ?? 0) + 1000}`);
  });
});

function attackProbeScript(hunterOwlCode: string): string {
  return `
    local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${hunterOwlCode}),1,LOCATION_MZONE,0,nil)
    Debug.Message("hunter owl target/stat protected/" .. tostring(c and c:GetAttack()))
  `;
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
