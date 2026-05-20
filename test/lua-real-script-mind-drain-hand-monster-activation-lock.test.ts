import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mind Drain hand monster activation lock", () => {
  it("restores its LP-cost hand monster-effect activation lock while allowing grave monster effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mindDrainCode = "68937720";
    const handMonsterCode = "68937721";
    const graveMonsterCode = "68937722";
    const handSpellCode = "68937723";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mindDrainCode),
      { code: handMonsterCode, name: "Mind Drain Hand Monster", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: graveMonsterCode, name: "Mind Drain Grave Monster", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: handSpellCode, name: "Mind Drain Hand Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6893, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mindDrainCode] }, 1: { main: [handMonsterCode, graveMonsterCode, handSpellCode] } });
    startDuel(session);

    const mindDrain = requireCard(session, mindDrainCode);
    const handMonster = requireCard(session, handMonsterCode);
    const graveMonster = requireCard(session, graveMonsterCode);
    const handSpell = requireCard(session, handSpellCode);
    moveDuelCard(session.state, mindDrain.uid, "spellTrapZone", 0);
    mindDrain.position = "faceDown";
    mindDrain.faceUp = false;
    moveDuelCard(session.state, handMonster.uid, "hand", 1);
    moveDuelCard(session.state, graveMonster.uid, "graveyard", 1);
    moveDuelCard(session.state, handSpell.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${handMonsterCode}.lua`) return handMonsterScript();
        if (name === `c${graveMonsterCode}.lua`) return graveMonsterScript();
        if (name === `c${handSpellCode}.lua`) return handSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mindDrainCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(handMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(graveMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(handSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === mindDrain.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.players[0]!.lifePoints).toBe(7000);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === mindDrain.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 1],
      luaValueDescriptor: "cannot-activate:location-monster-effect:2",
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    restoredLock.session.state.phase = "main1";
    expectRestoredLegalActions(restoredLock, 1);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === handMonster.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === graveMonster.uid)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === handSpell.uid)).toBe(true);
  });
});

function handMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("mind drain hand monster resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function graveMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_GRAVE)
      e:SetOperation(function(e,tp) Debug.Message("mind drain grave monster resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function handSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("mind drain hand spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
