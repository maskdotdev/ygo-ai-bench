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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sonic Jammer Spell activation lock", () => {
  it("restores its Spell Card activation lock while allowing Trap activations", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const jammerCode = "84550200";
    const spellCode = "84550201";
    const trapCode = "84550202";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === jammerCode),
      { code: spellCode, name: "Sonic Jammer Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: trapCode, name: "Sonic Jammer Opponent Trap", kind: "trap", typeFlags: 0x4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 845, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jammerCode] }, 1: { main: [spellCode, trapCode] } });
    startDuel(session);

    const jammer = requireCard(session, jammerCode);
    const spell = requireCard(session, spellCode);
    const trap = requireCard(session, trapCode);
    moveDuelCard(session.state, jammer.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, spell.uid, "hand", 1);
    moveDuelCard(session.state, trap.uid, "spellTrapZone", 1);
    trap.position = "faceDownDefense";
    trap.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${spellCode}.lua`) return opponentSpellScript();
        if (name === `c${trapCode}.lua`) return opponentTrapScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jammerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(trapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const operation = host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${jammerCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
        local e=Effect.CreateEffect(c)
        c84550200.operation(e,0,Group.CreateGroup(),0,0,nil,0,0)
      `,
      "sonic-jammer-operation-probe.lua",
    );
    expect(operation.ok, operation.error).toBe(true);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(restoredLock.session.state.effects.find((effect) => effect.sourceUid === jammer.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [0, 1],
      luaValueDescriptor: "cannot-activate:spell-card-activation",
    });
    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === spell.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === trap.uid)).toBe(true);
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("sonic jammer opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function opponentTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("sonic jammer opponent trap resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  }
}
