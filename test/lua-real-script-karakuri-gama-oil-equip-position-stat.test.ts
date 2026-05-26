import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setKarakuri = 0x11;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Karakuri Gama Oil equip position stat", () => {
  it("restores Karakuri Gama Oil's Graveyard revival equip limit and position-change ATK/DEF boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oilCode = "11699941";
    const karakuriCode = "116999410";
    const responderCode = "116999411";
    const script = workspace.readScript(`c${oilCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP+CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.Equip(tp,c,tc)");
    expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
    expect(script).toContain("e2:SetCode(EVENT_CHANGE_POS)");
    expect(script).toContain("eg:IsExists(s.cfilter,1,nil,tp)");
    expect(script).toContain("ec:UpdateAttack(500,nil,c)");
    expect(script).toContain("ec:UpdateDefense(500,nil,c)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === oilCode),
      { code: karakuriCode, name: "Karakuri Gama Oil Graveyard Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 1700, defense: 1200 },
      { code: responderCode, name: "Karakuri Gama Oil Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 11699941, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oilCode, karakuriCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const oil = requireCard(session, oilCode);
    const karakuri = requireCard(session, karakuriCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, oil.uid, "hand", 0);
    moveDuelCard(session.state, karakuri.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(oilCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === oil.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: oil.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [5],
        targetUids: [karakuri.uid],
        operationInfos: [
          { category: 0x200, targetUids: [karakuri.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x40000, targetUids: [oil.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("karakuri oil responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === karakuri.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: oil.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === oil.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: karakuri.uid,
      cardTargetUids: [karakuri.uid],
      faceUp: true,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: karakuri.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: oil.uid,
        eventReasonEffectId: 1,
        eventUids: [karakuri.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expectLuaEquipProbe(restoredEquipped, karakuriCode, oilCode, "karakuri oil probe 11699941/116999410/true");
    changePositionWithLua(restoredEquipped, karakuriCode);
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === karakuri.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: karakuri.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: oil.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    const statTrigger = getLuaRestoreLegalActions(restoredEquipped, 0).find((action) => action.type === "activateTrigger" && action.uid === oil.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipped, statTrigger!);
    resolveRestoredChain(restoredEquipped);
    expect(currentAttack(restoredEquipped.session.state.cards.find((card) => card.uid === karakuri.uid), restoredEquipped.session.state)).toBe(2200);
    expect(currentDefense(restoredEquipped.session.state.cards.find((card) => card.uid === karakuri.uid), restoredEquipped.session.state)).toBe(1700);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("karakuri oil responder resolved") end)
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function changePositionWithLua(restored: ReturnType<typeof restoreDuelWithLuaScripts>, karakuriCode: string): void {
  const probe = restored.host.loadScript(
    `
      local monster=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${karakuriCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("karakuri oil change position " .. Duel.ChangePosition(monster,POS_FACEUP_DEFENSE))
    `,
    "karakuri-gama-oil-position-change.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain("karakuri oil change position 1");
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, karakuriCode: string, oilCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local monster=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${karakuriCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${oilCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipCode=equip and equip:GetCode() or "nil"
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("karakuri oil probe " .. equipCode .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil))
    `,
    "karakuri-gama-oil-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
