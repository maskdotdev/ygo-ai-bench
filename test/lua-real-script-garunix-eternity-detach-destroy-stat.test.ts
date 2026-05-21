import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const garunixCode = "64182380";
const materialCode = "641823800";
const targetTrapCode = "641823801";
const responderCode = "641823802";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGarunixScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${garunixCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typeTrap = 0x4;
const racePyro = 0x80;
const raceBeast = 0x4000;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasGarunixScript)("Lua real script Garunix Eternity detach destroy stat", () => {
  it("restores detach-cost Spell/Trap destruction into self ATK update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${garunixCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,8,2,nil,nil,Xyz.InfiniteMats)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("return chkc:IsOnField() and chkc:IsSpellTrap()");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,500)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e) and Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("c:IsFaceup() and c:IsRelateToEffect(e)");
    expect(script).toContain("c:UpdateAttack(500)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 64182380, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, targetTrapCode], extra: [garunixCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const garunix = requireCard(session, garunixCode);
    const material = requireCard(session, materialCode);
    const targetTrap = requireCard(session, targetTrapCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, garunix, 0);
    garunix.summonType = "xyz";
    garunix.summonTypeCode = 0x49000000;
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    garunix.overlayUids.push(material.uid);
    moveDuelCard(session.state, targetTrap.uid, "spellTrapZone", 1);
    targetTrap.faceUp = false;
    targetTrap.position = "faceDown";
    moveDuelCard(session.state, responder.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(garunixCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === garunix.uid), restoredOpen.session.state)).toBe(3000);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === garunix.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === garunix.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: garunix.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3",
        sourceUid: garunix.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [targetTrap.uid],
        operationInfos: [
          { category: 0x1, targetUids: [targetTrap.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x200000, targetUids: [garunix.uid], count: 1, player: 0, parameter: 500 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("garunix responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === targetTrap.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: garunix.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === garunix.uid), restoredChain.session.state)).toBe(3500);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      materialSentToGraveyardEvent(material.uid, garunix.uid),
      detachedMaterialEvent(material.uid, garunix.uid),
      becameTargetEvent(targetTrap.uid),
      destroyedEvent(targetTrap.uid, garunix.uid),
      sentToGraveyardEvent(targetTrap.uid, garunix.uid),
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: garunixCode, name: "Garunix Eternity, Hyang of the Fire Kings", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: racePyro, attribute: attributeFire, level: 8, attack: 3000, defense: 2000 },
    { code: materialCode, name: "Garunix Eternity Material", kind: "monster", typeFlags: typeMonster, race: raceBeast, attribute: attributeFire, level: 8, attack: 1000, defense: 1000 },
    { code: targetTrapCode, name: "Garunix Eternity Trap Target", kind: "trap", typeFlags: typeTrap },
    { code: responderCode, name: "Garunix Eternity Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("garunix responder resolved") end)
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

function detachedMaterialEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "detachedMaterial",
    eventCode: 1202,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
}

function materialSentToGraveyardEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
}

function becameTargetEvent(cardUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 3,
    eventChainDepth: 1,
    eventChainLinkId: "chain-3",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
}

function sentToGraveyardEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
}
