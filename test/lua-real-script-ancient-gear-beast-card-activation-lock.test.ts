import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ancient Gear Beast card activation lock", () => {
  it("restores its attack-time card-activation lock while allowing monster effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const beastCode = "10509340";
    const opponentSpellCode = "10509341";
    const responderCode = "10509342";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === beastCode),
      { code: opponentSpellCode, name: "Ancient Gear Beast Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Ancient Gear Beast Monster Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 105, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [beastCode] }, 1: { main: [opponentSpellCode, responderCode] } });
    startDuel(session);

    const beast = requireCard(session, beastCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, beast.uid, "monsterZone", 0);
    beast.position = "faceUpAttack";
    beast.faceUp = true;
    moveDuelCard(session.state, opponentSpell.uid, "hand", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
        if (name === `c${responderCode}.lua`) return monsterResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(beastCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredSetup, 0);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find((action) => action.type === "declareAttack" && action.attackerUid === beast.uid && !action.targetUid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    const attacked = applyLuaRestoreResponse(restoredSetup, attack!);
    expect(attacked.ok, attacked.error).toBe(true);

    const restoredAttackWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expect(restoredAttackWindow.restoreComplete, restoredAttackWindow.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredAttackWindow, 1);
    expect(restoredAttackWindow.missingRegistryKeys).toEqual([]);
    expect(restoredAttackWindow.session.state.effects.find((effect) => effect.sourceUid === beast.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [0, 1],
      luaValueDescriptor: "cannot-activate:card-activation",
    });
    expect(getLuaRestoreLegalActionGroups(restoredAttackWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredAttackWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredAttackWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredAttackWindow, 1));
    expect(getLuaRestoreLegalActions(restoredAttackWindow, 1).some((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredAttackWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("ancient gear beast opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function monsterResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("ancient gear beast monster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
