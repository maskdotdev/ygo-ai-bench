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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sasuke Samurai #2 Spell/Trap activation lock", () => {
  it("restores its LP-cost Spell/Trap activation lock from a named predicate", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sasukeCode = "11760174";
    const opponentSpellCode = "11760175";
    const responderCode = "11760176";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sasukeCode),
      { code: opponentSpellCode, name: "Sasuke Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Sasuke Monster Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 117, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sasukeCode] }, 1: { main: [opponentSpellCode, responderCode] } });
    startDuel(session);

    const sasuke = requireCard(session, sasukeCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, sasuke.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponentSpell.uid, "hand", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
        if (name === `c${responderCode}.lua`) return monsterResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sasukeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sasuke.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.players[0]!.lifePoints).toBe(7200);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === sasuke.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 1],
      luaValueDescriptor: "cannot-activate:spell-trap-effect",
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    restoredLock.session.state.phase = "main1";
    expect(getLuaRestoreLegalActionGroups(restoredLock, 1)).toEqual(getGroupedDuelLegalActions(restoredLock.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredLock, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredLock, 1),
    );
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("sasuke opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function monsterResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("sasuke monster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
