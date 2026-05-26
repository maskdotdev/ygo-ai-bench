import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, fusionSummonDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const fluffalCatCode = "2729285";
const hasFluffalCatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fluffalCatCode}.lua`));
const polymerizationCode = "24094653";
const partnerCode = "272928500";
const fusionCode = "272928501";
const decoySpellCode = "272928502";
const responderCode = "272928503";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts || !hasFluffalCatScript)("Lua real script Fluffal Cat Fusion material Polymerization", () => {
  it("restores delayed Fusion-material trigger targeting Polymerization in Graveyard to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fluffalCatCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
    expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and r==REASON_FUSION");
    expect(script).toContain("return c:IsCode(CARD_POLYMERIZATION) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: fluffalCatCode, name: "Fluffal Cat", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 700, defense: 300 },
      { code: polymerizationCode, name: "Polymerization", kind: "spell", typeFlags: typeSpell },
      { code: partnerCode, name: "Fluffal Cat Fusion Partner", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Fluffal Cat Fusion Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 4, attack: 1800, defense: 1600, fusionMaterials: [fluffalCatCode, partnerCode] },
      { code: decoySpellCode, name: "Fluffal Cat Grave Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Fluffal Cat Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2729285, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fluffalCatCode, polymerizationCode, partnerCode, decoySpellCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const cat = requireCard(session, fluffalCatCode);
    const polymerization = requireCard(session, polymerizationCode);
    const partner = requireCard(session, partnerCode);
    const fusion = requireCard(session, fusionCode);
    const decoySpell = requireCard(session, decoySpellCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, cat, 0);
    moveFaceUpAttack(session, partner, 0);
    moveDuelCard(session.state, polymerization.uid, "graveyard", 0, duelReason.effect, 0);
    moveDuelCard(session.state, decoySpell.uid, "graveyard", 0, duelReason.effect, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fluffalCatCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const fusionAction = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "fusionSummon" && action.uid === fusion.uid && action.materialUids.includes(cat.uid) && action.materialUids.includes(partner.uid),
    );
    expect(fusionAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    fusionSummonDuelCard(restoredOpen.session.state, 0, fusion.uid, [cat.uid, partner.uid]);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === cat.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.fusion,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "fusion",
      summonMaterialUids: [cat.uid, partner.uid],
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial" && event.eventCardUid === cat.uid)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: cat.uid,
        eventReason: duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusion.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
    ]);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-4-1",
        effectId: "lua-1-1108",
        sourceUid: cat.uid,
        triggerBucket: "turnOptional",
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventPlayer: 0,
        eventCardUid: cat.uid,
        eventReason: duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusion.uid,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cat.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        sourceUid: cat.uid,
        player: 0,
        effectId: "lua-1-1108",
        activationLocation: "graveyard",
        activationSequence: 2,
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventPlayer: 0,
        eventCardUid: cat.uid,
        eventReason: duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusion.uid,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
        targetFieldIds: [9],
        targetUids: [polymerization.uid],
        operationInfos: [{ category: 0x8, targetUids: [polymerization.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === polymerization.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(restoredChain.session.state.cards.find((card) => card.uid === decoySpell.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.host.messages).not.toContain("fluffal cat responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => ["usedAsMaterial", "sentToHand"].includes(event.eventName) && event.eventCardUid !== partner.uid)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: cat.uid,
        eventReason: duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusion.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: polymerization.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cat.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("fluffal cat responder resolved") end)
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
