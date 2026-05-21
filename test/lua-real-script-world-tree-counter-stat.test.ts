import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDuelCardCounter } from "#duel/counters.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const worldTreeCode = "5973663";
const plantCode = "59736630";
const warriorCode = "59736631";
const responderCode = "59736632";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWorldTreeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${worldTreeCode}.lua`));
const flowerCounter = 0x18;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x10000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasWorldTreeScript)("Lua real script World Tree counter stat", () => {
  it("restores Flower Counter cost into targeted Plant ATK/DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${worldTreeCode}.lua`);
    expect(script).toContain("c:EnableCounterPermit(0x18)");
    expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("c:IsPreviousPosition(POS_FACEUP)");
    expect(script).toContain("(c:GetPreviousRaceOnField()&RACE_PLANT)~=0");
    expect(script).toContain("e:GetHandler():AddCounter(0x18,1)");
    expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,0x18,1,REASON_COST)");
    expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x18,1,REASON_COST)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter1,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,0,500)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(400)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.IsExistingTarget(aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter3,tp,LOCATION_GRAVE,0,1,nil,e,tp)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 5973663, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [worldTreeCode, plantCode, warriorCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const tree = requireCard(session, worldTreeCode);
    const plant = requireCard(session, plantCode);
    const warrior = requireCard(session, warriorCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, tree.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, plant, 0);
    moveFaceUpAttack(session, warrior, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    expect(addDuelCardCounter(tree, flowerCounter, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(worldTreeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tree.uid)?.counters?.[flowerCounter]).toBe(1);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === tree.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tree.uid)?.counters?.[flowerCounter] ?? 0).toBe(0);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-4",
        sourceUid: tree.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetUids: [plant.uid],
        operationInfos: [{ category: 0x200000, targetUids: [plant.uid], count: 1, player: 0, parameter: 500 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("world tree responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === plant.uid), restoredChain.session.state)).toBe(1400);
    expect(currentDefense(restoredChain.session.state.cards.find((card) => card.uid === plant.uid), restoredChain.session.state)).toBe(1400);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === warrior.uid), restoredChain.session.state)).toBe(1200);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "chainSolved"].includes(event.eventName))).toEqual([
      becameTargetEvent(plant.uid),
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: worldTreeCode, name: "The World Tree", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: plantCode, name: "World Tree Plant Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: warriorCode, name: "World Tree Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: responderCode, name: "World Tree Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("world tree responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function becameTargetEvent(cardUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 4,
    eventChainDepth: 1,
    eventChainLinkId: "chain-2",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
}
