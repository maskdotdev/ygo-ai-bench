import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceDinosaur = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script World Suppression field disable", () => {
  it("restores an EVENT_CHAINING Trap that registers a temporary Field Spell disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const worldSuppressionCode = "12253117";
    const jurassicWorldCode = "10080320";
    const dinosaurCode = "12253118";
    const script = workspace.readScript(`c${worldSuppressionCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("return re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsActiveType(TYPE_FIELD)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_SZONE,LOCATION_SZONE)");
    expect(script).toContain("return c:IsType(TYPE_FIELD)");

    const jurassicScript = workspace.readScript(`c${jurassicWorldCode}.lua`);
    expect(jurassicScript).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(jurassicScript).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(jurassicScript).toContain("e2:SetRange(LOCATION_FZONE)");
    expect(jurassicScript).toContain("e2:SetTarget(aux.TargetBoolFunction(Card.IsRace,RACE_DINOSAUR))");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [worldSuppressionCode, jurassicWorldCode].includes(card.code)),
      { code: dinosaurCode, name: "World Suppression Dinosaur Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceDinosaur },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1225, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jurassicWorldCode, dinosaurCode] }, 1: { main: [worldSuppressionCode] } });
    startDuel(session);

    const jurassicWorld = session.state.cards.find((card) => card.code === jurassicWorldCode);
    const worldSuppression = session.state.cards.find((card) => card.code === worldSuppressionCode);
    const dinosaur = session.state.cards.find((card) => card.code === dinosaurCode);
    expect(jurassicWorld).toBeDefined();
    expect(worldSuppression).toBeDefined();
    expect(dinosaur).toBeDefined();
    moveDuelCard(session.state, jurassicWorld!.uid, "hand", 0);
    moveDuelCard(session.state, dinosaur!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, worldSuppression!.uid, "spellTrapZone", 1);
    worldSuppression!.position = "faceDown";
    worldSuppression!.faceUp = false;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jurassicWorldCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(worldSuppressionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activateFieldSpell = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === jurassicWorld!.uid);
    expect(activateFieldSpell, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activateFieldSpell!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-10080320-0",
      }
    `);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredResponseWindow);
    expectRestoredLegalActions(restoredResponseWindow, 1);
    const suppressField = getLuaRestoreLegalActions(restoredResponseWindow, 1).find((action) => action.type === "activateEffect" && action.uid === worldSuppression!.uid);
    expect(suppressField, JSON.stringify(getLuaRestoreLegalActions(restoredResponseWindow, 1), null, 2)).toBeDefined();
    expect(suppressField?.windowKind).toBe("chainResponse");
    const chained = applyLuaRestoreResponse(restoredResponseWindow, suppressField!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredResponseWindow.session.state.chain).toHaveLength(0);
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === jurassicWorld!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === worldSuppression!.uid)).toMatchObject({ location: "graveyard" });

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredResponseWindow.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);

    const restoredJurassicWorld = restoredResolved.session.state.cards.find((card) => card.uid === jurassicWorld!.uid)!;
    const restoredWorldSuppression = restoredResolved.session.state.cards.find((card) => card.uid === worldSuppression!.uid)!;
    const restoredDinosaur = restoredResolved.session.state.cards.find((card) => card.uid === dinosaur!.uid)!;
    expect(restoredJurassicWorld).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(restoredWorldSuppression).toMatchObject({ location: "graveyard" });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 2).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      {
        code: 2,
        controller: 1,
        luaTargetDescriptor: "target:type:524288",
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        sourceUid: worldSuppression!.uid,
        targetRange: [8, 8],
      },
    ]);
    expect(currentAttack(restoredDinosaur, restoredResolved.session.state)).toBe(1000);
    expect(currentDefense(restoredDinosaur, restoredResolved.session.state)).toBe(1000);

    const probe = restoredResolved.host.loadScript(
      `
      local field_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${jurassicWorldCode}), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("world suppression field disabled " .. tostring(field_spell:IsDisabled()))
      `,
      "world-suppression-disabled-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredResolved.host.messages).toContain("world suppression field disabled true");
    expect(restoredResolved.host.messages).not.toContain("world suppression field disabled false");
  });
});

function expectCleanRestore(restored: LuaSnapshotRestoreResult): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): void {
  const groups = getLuaRestoreLegalActionGroups(restored, player);
  const actions = getLuaRestoreLegalActions(restored, player);
  expect(actions).toEqual(getLegalActions(restored.session, player));
  expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(groups.flatMap((group) => group.actions)).toEqual(actions);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
