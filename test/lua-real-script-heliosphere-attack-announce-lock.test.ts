import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Heliosphere attack announce lock", () => {
  it("restores its conditional opponent cannot-attack-announce field lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const heliosphereCode = "51043053";
    const attackerCode = "900000600";
    const handCodes = ["900000602", "900000603", "900000604", "900000605", "900000606"];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heliosphereCode),
      { code: attackerCode, name: "Heliosphere Locked Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      ...handCodes.map((code) => ({ code, name: `Heliosphere Hand Probe ${code}`, kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5104, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heliosphereCode] }, 1: { main: [attackerCode, ...handCodes] } });
    startDuel(session);

    const heliosphere = requireCard(session, heliosphereCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, heliosphere, 0);
    moveFaceUpAttack(session, attacker, 1);
    for (const code of handCodes.slice(0, 4)) moveDuelCard(session.state, requireCard(session, code).uid, "hand", 1);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heliosphereCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === heliosphere.uid && effect.code === 86)).toBeDefined();
    expect(session.state.effects.find((effect) => effect.sourceUid === heliosphere.uid && effect.code === 86)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 86,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-86",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:51043053:lua-1-86",
        "sourceUid": "p0-deck-51043053-0",
        "target": [Function],
        "targetRange": [
          0,
          4,
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 1),
    );
    expect(restored.host.loadScript(canAttackProbe(attackerCode, "locked"), "heliosphere-attack-locked-probe.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("heliosphere locked CanAttack false");
    let actions = getLuaRestoreLegalActions(restored, 1);
    expect(hasAttack(actions, attacker.uid, heliosphere.uid)).toBe(false);

    moveDuelCard(restored.session.state, requireCard(restored.session, handCodes[4]!).uid, "hand", 1);
    expect(restored.host.loadScript(canAttackProbe(attackerCode, "open"), "heliosphere-attack-open-probe.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("heliosphere open CanAttack true");
    actions = getLuaRestoreLegalActions(restored, 1);
    expect(hasAttack(actions, attacker.uid, heliosphere.uid)).toBe(true);
    const attack = actions.find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === heliosphere.uid);
    expect(attack, JSON.stringify(actions, null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, attack!);
    expect(result.ok, result.error).toBe(true);
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? 1));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor ?? 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });
});

function canAttackProbe(attackerCode: string, label: string): string {
  return `
    local attacker=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${attackerCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message("heliosphere ${label} CanAttack " .. tostring(attacker:CanAttack()))
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
