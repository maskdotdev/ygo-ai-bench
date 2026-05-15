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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lunalight Kaleido Chick remove activation lock", () => {
  it("restores its banish trigger and battle-phase static cannot-activate lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kaleidoCode = "35618217";
    const opponentSpellCode = "35618218";
    const responderCode = "35618219";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kaleidoCode),
      { code: opponentSpellCode, name: "Kaleido Chick Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Kaleido Chick Monster Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 356, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kaleidoCode] }, 1: { main: [opponentSpellCode, responderCode] } });
    startDuel(session);

    const kaleido = requireCard(session, kaleidoCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, kaleido.uid, "monsterZone", 0);
    kaleido.position = "faceUpAttack";
    kaleido.faceUp = true;
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
    expect(host.loadCardScript(Number(kaleidoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const banished = host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${kaleidoCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
        Debug.Message("kaleido banish " .. Duel.Remove(c,POS_FACEUP,REASON_EFFECT))
      `,
      "kaleido-banish.lua",
    );
    expect(banished.ok, banished.error).toBe(true);
    expect(host.messages).toContain("kaleido banish 1");
    expect(session.state.cards.find((card) => card.uid === kaleido.uid)).toMatchObject({ location: "banished" });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === kaleido.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, restoredLock.session.state.waitingFor ?? restoredLock.session.state.turnPlayer);
    expect(restoredLock.session.state.effects.find((effect) => effect.sourceUid === kaleido.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [0, 1],
      value: 1,
    });
    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    restoredLock.session.state.phase = "battle";
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(false);
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("kaleido opponent spell resolved") end)
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
      e:SetOperation(function(e,tp) Debug.Message("kaleido monster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  expect(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer)).toEqual(
    getGroupedDuelLegalActions(restored.session, restored.session.state.waitingFor ?? restored.session.state.turnPlayer),
  );
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
