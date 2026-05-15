import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const effectChangeDamage = 82;
const effectNoEffectDamage = 335;
const resetPhaseEnd = 0x40000200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hanewata effect damage prevention", () => {
  it("restores its effect-damage-only callback while leaving battle damage unchanged", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hanewataCode = "20450925";
    const fireCode = "46918794";
    const attackerCode = "204501";
    const responderCode = "204502";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hanewataCode || card.code === fireCode),
      { code: attackerCode, name: "Hanewata Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Hanewata Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2045, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hanewataCode] }, 1: { main: [fireCode, attackerCode, responderCode] } });
    startDuel(session);

    const hanewata = session.state.cards.find((card) => card.code === hanewataCode);
    const fire = session.state.cards.find((card) => card.code === fireCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(hanewata).toBeDefined();
    expect(fire).toBeDefined();
    expect(attacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, hanewata!.uid, "hand", 0);
    moveDuelCard(session.state, fire!.uid, "hand", 1);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hanewataCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fireCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const hanewataActivation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === hanewata!.uid);
    expect(hanewataActivation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, hanewataActivation!);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === hanewata!.uid)).toMatchObject({ location: "graveyard", previousLocation: "hand" });
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: hanewata!.uid, code: effectChangeDamage, targetRange: [1, 0], reset: { flags: resetPhaseEnd } }),
        expect.objectContaining({ sourceUid: hanewata!.uid, code: effectNoEffectDamage, targetRange: [1, 0], reset: { flags: resetPhaseEnd } }),
      ]),
    );
    expect(restoredChain.host.messages).not.toContain("hanewata responder resolved");

    const restoredEffects = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEffects.restoreComplete, restoredEffects.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEffects.missingRegistryKeys).toEqual([]);
    expect(restoredEffects.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEffects, 0);
    expect(restoredEffects.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: hanewata!.uid, code: effectChangeDamage, targetRange: [1, 0], luaValueDescriptor: "change-damage:effect-zero", reset: { flags: resetPhaseEnd } }),
        expect.objectContaining({ sourceUid: hanewata!.uid, code: effectNoEffectDamage, targetRange: [1, 0], luaValueDescriptor: "change-damage:effect-zero", reset: { flags: resetPhaseEnd } }),
      ]),
    );
    restoredEffects.session.state.turnPlayer = 1;
    restoredEffects.session.state.phase = "main1";
    restoredEffects.session.state.waitingFor = 1;
    const fireActivation = getLuaRestoreLegalActions(restoredEffects, 1).find((action) => action.type === "activateEffect" && action.uid === fire!.uid);
    expect(fireActivation, JSON.stringify(getLuaRestoreLegalActions(restoredEffects, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEffects, fireActivation!);

    const restoredFire = restoreDuelWithLuaScripts(serializeDuel(restoredEffects.session), source, reader);
    expect(restoredFire.restoreComplete, restoredFire.incompleteReasons.join("; ")).toBe(true);
    expect(restoredFire.missingRegistryKeys).toEqual([]);
    expect(restoredFire.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredFire, 1);
    resolveRestoredChain(restoredFire);
    expect(restoredFire.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredFire.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt" && event.eventPlayer === 0)).toEqual([]);
    expect(restoredFire.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: fire!.uid,
        eventReasonEffectId: 2,
      },
    ]);

    restoredFire.session.state.phase = "battle";
    restoredFire.session.state.waitingFor = 1;
    const directAttack = getLuaRestoreLegalActions(restoredFire, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.directAttack);
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredFire, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredFire, directAttack!);
    passBattleResponses(restoredFire);

    expect(restoredFire.session.state.players[0].lifePoints).toBe(6200);
    expect(restoredFire.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredFire.session.state.battleDamage).toEqual({ 0: 1800, 1: 0 });
    expect(restoredFire.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "battleDamageDealt", eventPlayer: 0, eventValue: 1800 })]));
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("hanewata responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
