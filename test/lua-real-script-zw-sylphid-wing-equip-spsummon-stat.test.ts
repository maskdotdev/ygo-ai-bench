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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const sylphidCode = "95886782";
const utopiaCode = "958867820";
const opponentSummonerCode = "958867821";
const summonTargetCode = "958867822";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setUtopia = 0x107f;

describe.skipIf(!hasUpstreamScripts)("Lua real script ZW Sylphid Wing equip summon stat", () => {
  it("restores ZW self-equip, overlay replacement metadata, and opponent Special Summon ATK gain trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sylphidCode}.lua`);
    expect(script).toContain("aux.AddZWEquipLimit(c,s.eqcon,function(tc,c,tp) return s.filter(tc) and tc:IsControler(tp) end,s.equipop,e1)");
    expect(script).toContain("aux.EquipAndLimitRegister(c,e,tp,tc)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(800)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("eg:IsExists(Card.IsSummonPlayer,1,nil,1-tp)");
    expect(script).toContain("ec:UpdateAttack(1600,nil,c)");
    expect(script).toContain("e3:SetCode(EFFECT_OVERLAY_REMOVE_REPLACE)");
    expect(script).toContain("re:IsActiveType(TYPE_XYZ)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${opponentSummonerCode}.lua`) return opponentSummonerScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 95886782, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sylphidCode], extra: [utopiaCode] }, 1: { main: [opponentSummonerCode, summonTargetCode] } });
    startDuel(session);

    const sylphid = requireCard(session, sylphidCode);
    const utopia = requireCard(session, utopiaCode);
    const opponentSummoner = requireCard(session, opponentSummonerCode);
    const summonTarget = requireCard(session, summonTargetCode);
    moveDuelCard(session.state, sylphid.uid, "hand", 0);
    moveFaceUpAttack(session, utopia, 0);
    moveDuelCard(session.state, opponentSummoner.uid, "hand", 1);
    moveDuelCard(session.state, summonTarget.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sylphidCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSummonerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const equip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === sylphid.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, equip!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === sylphid.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: utopia.uid,
      cardTargetUids: [utopia.uid],
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sylphid.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === utopia.uid), restoredOpen.session.state)).toBe(3300);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(restoredEquipped.host.messages).not.toContain("sylphid wing unexpected responder");
    expectLuaProbe(restoredEquipped, "sylphid wing probe 95886782/958867820/true/3300");
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === sylphid.uid && [76, 100, 245, 1102].includes(effect.code ?? -1)).map((effect) => ({
      id: effect.id,
      event: effect.event,
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { id: "lua-4-1102", event: "trigger", code: 1102, property: 0x10000, range: ["spellTrapZone"], reset: undefined, value: undefined },
      { id: "lua-5-245", event: "continuous", code: 245, property: undefined, range: ["spellTrapZone"], reset: undefined, value: undefined },
      { id: "lua-7-76", event: "continuous", code: 76, property: 0x400, range: ["spellTrapZone"], reset: { flags: 33427456 }, value: undefined },
      { id: "lua-8-100", event: "continuous", code: 100, property: undefined, range: ["spellTrapZone"], reset: { flags: 33427456 }, value: 800 },
    ]);

    restoredEquipped.session.state.turnPlayer = 1;
    restoredEquipped.session.state.waitingFor = 1;
    const summon = getLuaRestoreLegalActions(restoredEquipped, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSummoner.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipped, summon!);
    expect(restoredEquipped.session.state.chain).toEqual([]);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 1,
      reasonCardUid: opponentSummoner.uid,
      reasonEffectId: 6,
    });
    expect(restoredEquipped.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonTarget.uid,
        eventUids: [summonTarget.uid],
        eventPlayer: 1,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 1,
        eventReasonCardUid: opponentSummoner.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        sourceUid: sylphid.uid,
        effectId: "lua-4-1102",
        player: 0,
        triggerBucket: "opponentOptional",
        eventTriggerTiming: "if",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sylphid.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === utopia.uid), restoredTrigger.session.state)).toBe(4900);
    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 1);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === utopia.uid), restoredBoost.session.state)).toBe(4900);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.code === 100).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, sourceUid: sylphid.uid, reset: { flags: 33427456 }, value: 800 }]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: sylphidCode, name: "ZW - Sylphid Wing", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 800, defense: 1600 },
    { code: utopiaCode, name: "Sylphid Wing Utopia", kind: "extra", typeFlags: typeMonster | typeXyz, setcodes: [setUtopia], level: 4, attack: 2500, defense: 2000 },
    { code: opponentSummonerCode, name: "Sylphid Wing Opponent Summoner", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: summonTargetCode, name: "Sylphid Wing Opponent Special Summon", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
  ];
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

function opponentSummonerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${summonTargetCode}),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
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

function expectLuaProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${sylphidCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("sylphid wing probe " .. tostring(equip and equip:GetCode()) .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. equipTarget:GetAttack())
    `,
    "sylphid-wing-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
