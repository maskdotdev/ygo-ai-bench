import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const blackWingedCode = "9012916";
const burnSpellCode = "90129160";
const targetCode = "90129161";
const responderCode = "90129162";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBlackWingedScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blackWingedCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeSpell = 0x2;
const featherCounter = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasBlackWingedScript)("Lua real script Black-Winged Dragon damage counter stat", () => {
  it("restores effect-damage replacement into Feather Counter ATK loss and counter-cost burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blackWingedCode}.lua`);
    expect(script).toContain("c:EnableCounterPermit(COUNTER_FEATHER)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_DAMAGE)");
    expect(script).toContain("e2:SetCode(EFFECT_NO_EFFECT_DAMAGE)");
    expect(script).toContain("e:GetHandler():AddCounter(COUNTER_FEATHER,1)");
    expect(script).toContain("return c:GetCounter(COUNTER_FEATHER)*-700");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_FEATHER,ct,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,e:GetLabel())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,0,-e:GetLabel())");
    expect(script).toContain("Duel.Damage(1-tp,val,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: blackWingedCode, name: "Black-Winged Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 8, attack: 2800, defense: 1600 },
      { code: burnSpellCode, name: "Black-Winged Dragon Burn Probe", kind: "spell", typeFlags: typeSpell },
      { code: targetCode, name: "Black-Winged Dragon Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Black-Winged Dragon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9012916, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [burnSpellCode], extra: [blackWingedCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const dragon = requireCard(session, blackWingedCode);
    const burnSpell = requireCard(session, burnSpellCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, dragon, 0);
    dragon.summonType = "synchro";
    moveDuelCard(session.state, burnSpell.uid, "hand", 0);
    moveFaceUpAttack(session, target, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${burnSpellCode}.lua`) return burnProbeScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blackWingedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(burnSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredBurnOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredBurnOpen);
    expectRestoredLegalActions(restoredBurnOpen, 0);
    const burn = getLuaRestoreLegalActions(restoredBurnOpen, 0).find((action) => action.type === "activateEffect" && action.uid === burnSpell.uid);
    expect(burn, JSON.stringify(getLuaRestoreLegalActions(restoredBurnOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredBurnOpen, burn!);
    expect(restoredBurnOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: burnSpell.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1000 }],
      },
    ]);

    const restoredBurnChain = restoreDuelWithLuaScripts(serializeDuel(restoredBurnOpen.session), source, reader);
    expectCleanRestore(restoredBurnChain);
    expectRestoredLegalActions(restoredBurnChain, 1);
    expect(getLuaRestoreLegalActions(restoredBurnChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredBurnChain);

    const restoredDragon = restoredBurnChain.session.state.cards.find((card) => card.uid === dragon.uid);
    expect(restoredBurnChain.host.messages).not.toContain("black-winged responder resolved");
    expect(restoredBurnChain.session.state.players[0].lifePoints).toBe(8000);
    expect(getDuelCardCounter(restoredDragon, featherCounter)).toBe(1);
    expect(currentAttack(restoredDragon, restoredBurnChain.session.state)).toBe(2100);
    expect(restoredBurnChain.session.state.eventHistory.filter((event) => event.eventName === "counterAdded")).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: dragon.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragon.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredBurnChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([]);

    const restoredIgnitionOpen = restoreDuelWithLuaScripts(serializeDuel(restoredBurnChain.session), source, reader);
    expectCleanRestore(restoredIgnitionOpen);
    expectRestoredLegalActions(restoredIgnitionOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnitionOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dragon.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnitionOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredIgnitionOpen, ignition!);

    expect(getDuelCardCounter(restoredIgnitionOpen.session.state.cards.find((card) => card.uid === dragon.uid), featherCounter)).toBe(0);
    expect(currentAttack(restoredIgnitionOpen.session.state.cards.find((card) => card.uid === dragon.uid), restoredIgnitionOpen.session.state)).toBe(2800);
    expect(restoredIgnitionOpen.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-8",
        effectLabel: 700,
        sourceUid: dragon.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [target.uid],
        operationInfos: [
          { category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 700 },
          { category: 0x200000, targetUids: [target.uid], count: 1, player: 0, parameter: -700 },
        ],
      },
    ]);

    const restoredIgnitionChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnitionOpen.session), source, reader);
    expectCleanRestore(restoredIgnitionChain);
    expectRestoredLegalActions(restoredIgnitionChain, 1);
    passRestoredChain(restoredIgnitionChain);

    expect(restoredIgnitionChain.session.state.players[1].lifePoints).toBe(7300);
    expect(currentAttack(restoredIgnitionChain.session.state.cards.find((card) => card.uid === target.uid), restoredIgnitionChain.session.state)).toBe(300);
    expect(restoredIgnitionChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 700,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragon.uid,
        eventReasonEffectId: 8,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
}

function burnProbeScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,1000)
      end)
      e:SetOperation(function(e,tp) Duel.Damage(tp,1000,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("black-winged responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
