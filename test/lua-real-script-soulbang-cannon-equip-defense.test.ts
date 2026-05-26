import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const soulbangCode = "3064425";
const targetCode = "30644250";
const decoyCode = "30644251";
const responderCode = "30644252";
const hasSoulbangScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${soulbangCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x80;
const attributeEarth = 0x1;
const setSuperheavySamurai = 0x9a;
const effectEquipLimit = 1015;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasSoulbangScript)("Lua real script Superheavy Samurai Soulbang Cannon equip defense", () => {
  it("restores hand equip targeting a Superheavy Samurai and grants the equipped monster 1000 DEF", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${soulbangCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 3064425, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soulbangCode, targetCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const soulbang = requireCard(session, soulbangCode);
    const target = requireCard(session, targetCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, soulbang.uid, "hand", 0);
    moveFaceUpDefense(session, target, 0, 0);
    moveFaceUpDefense(session, decoy, 0, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(soulbangCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const equip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === soulbang.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, equip!);

    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: soulbang.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [target.fieldId],
        targetUids: [target.uid],
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.chain[0]?.targetUids).not.toContain(decoy.uid);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("soulbang responder resolved");

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === soulbang.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target.uid,
      faceUp: true,
    });
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === decoy.uid)?.equippedToUid).toBeUndefined();
    expect(restoredEquipState.session.state.effects.filter((effect) => effect.sourceUid === soulbang.uid && effect.code === effectUpdateDefense).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateDefense, event: "continuous", range: ["spellTrapZone"], reset: { flags: 33427456 }, value: 1000 },
    ]);
    const restoredTarget = restoredEquipState.session.state.cards.find((card) => card.uid === target.uid)!;
    const restoredDecoy = restoredEquipState.session.state.cards.find((card) => card.uid === decoy.uid)!;
    expect(currentDefense(restoredTarget, restoredEquipState.session.state)).toBe(3000);
    expect(currentDefense(restoredDecoy, restoredEquipState.session.state)).toBe(1500);
    expectLuaEquipProbe(restoredEquipState, "soulbang probe 3064425/30644250/true/3000");
  });
});

function cards(): DuelCardData[] {
  return [
    { code: soulbangCode, name: "Superheavy Samurai Soulbang Cannon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 3, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Soulbang Superheavy Samurai Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1200, defense: 2000, setcodes: [setSuperheavySamurai] },
    { code: decoyCode, name: "Soulbang Non-Superheavy Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1100, defense: 1500 },
    { code: responderCode, name: "Soulbang Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Superheavy Samurai Soulbang Cannon");
  expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_MZONE)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_SUPERHEAVY_SAMURAI)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_SZONE)>0");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.Equip(tp,c,tc,true)");
  expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e2:SetValue(1000)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.RDComplete()");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.position = "faceUpDefense";
  moved.faceUp = true;
  return moved;
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("soulbang responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const result = restored.host.loadScript(`
    local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${soulbangCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
    local target=equip and equip:GetEquipTarget()
    Debug.Message("soulbang probe " .. tostring(equip and equip:GetCode()) .. "/" .. tostring(target and target:GetCode()) .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. tostring(target and target:GetDefense()))
  `, "soulbang-equip-defense-probe.lua");
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
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
  const waitingFor = restored.session.state.waitingFor;
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
