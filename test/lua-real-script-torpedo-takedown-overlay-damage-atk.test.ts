import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const torpedoCode = "45943123";
const xyzCode = "459431230";
const materialCode = "459431231";
const handACode = "459431232";
const handBCode = "459431233";
const responderCode = "459431234";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const attributeWater = 0x2;
const raceAqua = 0x20;

describe.skipIf(!hasUpstreamScripts)("Lua real script Torpedo Takedown overlay damage ATK", () => {
  it("restores overlay detach into hand-count damage and matching ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${torpedoCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_WATER) and c:IsType(TYPE_XYZ) and c:GetOverlayCount()>0");
    expect(script).toContain("Duel.GetMatchingGroup(nil,tp,LOCATION_HAND,0,e:GetHandler())");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,#hg)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g:GetFirst(),1,tp,0)");
    expect(script).toContain("tc:RemoveOverlayCard(tp,1,1,REASON_EFFECT)>0");
    expect(script).toContain("Duel.AdjustInstantly(tc)");
    expect(script).toContain("local d=Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)*400");
    expect(script).toContain("local dam=Duel.Damage(p,d,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(dam)");

    const cards: DuelCardData[] = [
      { code: torpedoCode, name: "Torpedo Takedown", kind: "spell", typeFlags: typeSpell },
      { code: xyzCode, name: "Torpedo WATER Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceAqua, attribute: attributeWater, level: 4, attack: 2000, defense: 1600 },
      { code: materialCode, name: "Torpedo Overlay Material", kind: "monster", typeFlags: typeMonster, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
      { code: handACode, name: "Torpedo Hand A", kind: "monster", typeFlags: typeMonster, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
      { code: handBCode, name: "Torpedo Hand B", kind: "monster", typeFlags: typeMonster, race: raceAqua, attribute: attributeWater, level: 4, attack: 1100, defense: 1000 },
      { code: responderCode, name: "Torpedo Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 45943123, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [torpedoCode, materialCode, handACode, handBCode], extra: [xyzCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const torpedo = requireCard(session.state.cards, torpedoCode);
    const xyz = requireCard(session.state.cards, xyzCode);
    const material = requireCard(session.state.cards, materialCode);
    const handA = requireCard(session.state.cards, handACode);
    const handB = requireCard(session.state.cards, handBCode);
    const responder = requireCard(session.state.cards, responderCode);
    moveDuelCard(session.state, torpedo.uid, "hand", 0);
    moveDuelCard(session.state, handA.uid, "hand", 0);
    moveDuelCard(session.state, handB.uid, "hand", 0);
    moveFaceUpAttack(session, xyz, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    xyz.overlayUids.push(material.uid);
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
    expect(host.loadCardScript(Number(torpedoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === torpedo.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: torpedo.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetUids: [xyz.uid],
        targetPlayer: 1,
        operationInfos: [
          { category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 2 },
          { category: 0x200000, targetUids: [xyz.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    const response = applyLuaRestoreResponse(restoredChain, pass!);
    expect(response.ok, response.error).toBe(true);

    const resolvedXyz = restoredChain.session.state.cards.find((card) => card.uid === xyz.uid);
    expect(resolvedXyz).toMatchObject({ location: "monsterZone", controller: 0, overlayUids: [] });
    expect(currentAttack(resolvedXyz, restoredChain.session.state)).toBe(2800);
    expect(restoredChain.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: torpedo.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["detachedMaterial", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: torpedo.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: torpedo.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.reason = duelReason.summon;
  card.reasonPlayer = controller;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function() Debug.Message("torpedo responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
