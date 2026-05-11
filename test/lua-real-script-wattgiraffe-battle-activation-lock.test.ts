import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wattgiraffe battle activation lock", () => {
  it("restores its direct-battle-damage static cannot-activate lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wattgiraffeCode = "402568";
    const opponentSpellCode = "402569";
    const responderCode = "402570";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wattgiraffeCode),
      { code: opponentSpellCode, name: "Wattgiraffe Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Wattgiraffe Monster Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 402, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wattgiraffeCode] }, 1: { main: [opponentSpellCode, responderCode] } });
    startDuel(session);

    const wattgiraffe = requireCard(session, wattgiraffeCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, wattgiraffe.uid, "monsterZone", 0);
    wattgiraffe.position = "faceUpAttack";
    wattgiraffe.faceUp = true;
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
    expect(host.loadCardScript(Number(wattgiraffeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find((action) => action.type === "declareAttack" && action.attackerUid === wattgiraffe.uid && !action.targetUid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleResponses(restoredSetup);
    expect(restoredSetup.session.state.players[1]!.lifePoints).toBe(6800);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === wattgiraffe.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.session.state.effects.find((effect) => effect.sourceUid === wattgiraffe.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [0, 1],
      value: 1,
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    restoredLock.session.state.phase = "main1";
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
      e:SetOperation(function(e,tp) Debug.Message("wattgiraffe opponent spell resolved") end)
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
      e:SetOperation(function(e,tp) Debug.Message("wattgiraffe monster responder resolved") end)
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
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
