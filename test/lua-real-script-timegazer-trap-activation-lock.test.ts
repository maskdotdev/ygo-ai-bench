import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Timegazer Magician Trap activation lock", () => {
  it("restores its Trap Card activation lock while allowing Spell activations", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const timegazerCode = "20409757";
    const spellCode = "20409758";
    const trapCode = "20409759";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === timegazerCode),
      { code: spellCode, name: "Timegazer Opponent Quick-Play Spell", kind: "spell", typeFlags: 0x10002 },
      { code: trapCode, name: "Timegazer Opponent Trap", kind: "trap", typeFlags: 0x4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 204, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [timegazerCode] }, 1: { main: [spellCode, trapCode] } });
    startDuel(session);

    const timegazer = requireCard(session, timegazerCode);
    const spell = requireCard(session, spellCode);
    const trap = requireCard(session, trapCode);
    moveDuelCard(session.state, timegazer.uid, "spellTrapZone", 0);
    timegazer.faceUp = true;
    moveDuelCard(session.state, spell.uid, "hand", 1);
    moveDuelCard(session.state, trap.uid, "spellTrapZone", 1);
    trap.position = "faceDownDefense";
    trap.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${spellCode}.lua`) return opponentSpellScript();
        if (name === `c${trapCode}.lua`) return opponentTrapScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(timegazerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(trapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(getDuelLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === spell.uid)).toBe(true);
    expect(getDuelLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === trap.uid)).toBe(true);

    const operation = host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${timegazerCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
        local e=Effect.CreateEffect(c)
        c20409757.actop(e,0,Group.CreateGroup(),0,0,nil,0,0)
      `,
      "timegazer-trap-lock-operation-probe.lua",
    );
    expect(operation.ok, operation.error).toBe(true);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredLock.session.state.effects.find((effect) => effect.sourceUid === timegazer.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [0, 1],
      luaValueDescriptor: "cannot-activate:trap-card-activation",
      reset: { flags: 0x40000020 },
    });
    restoredLock.session.state.phase = "battle";
    restoredLock.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActionGroups(restoredLock, 1)).toEqual(getGroupedDuelLegalActions(restoredLock.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredLock, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredLock, 1));
    expect(getLuaRestoreLegalActions(restoredLock, 1)).toEqual(getDuelLegalActions(restoredLock.session, 1));
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === spell.uid)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === trap.uid)).toBe(false);
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("timegazer opponent spell resolved") end)
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
      e:SetOperation(function(e,tp) Debug.Message("timegazer opponent trap resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
