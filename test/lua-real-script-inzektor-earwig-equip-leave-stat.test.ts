import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const earwigCode = "38450736";
const hasEarwigScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${earwigCode}.lua`));
const hostCode = "384507360";
const equipCode = "384507361";
const responderCode = "384507362";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setInzektor = 0x56;

describe.skipIf(!hasUpstreamScripts || !hasEarwigScript)("Lua real script Inzektor Earwig equip leave stat", () => {
  it("restores AddEREquipLimit ignition equip, equip ATK/DEF, and leave-field target ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${earwigCode}.lua`);
    expect(script).toContain("aux.AddEREquipLimit(c,nil,s.eqval,s.equipop,e1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,nil,1,tp,LOCATION_GRAVE|LOCATION_HAND)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter),tp,LOCATION_GRAVE|LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("c:EquipByEffectAndLimitRegister(e,tp,tc,nil,true)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("Duel.SetTargetCard(ec)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        if (name === `c${equipCode}.lua`) return workspace.readScript(`official/c${earwigCode}.lua`);
        return workspace.readScript(name);
      },
    };
    const session = createSession(reader);
    const earwig = requireCard(session, earwigCode);
    const host = requireCard(session, hostCode);
    const equip = requireCard(session, equipCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, earwig, 0);
    moveFaceUpAttack(session, host, 0);
    moveDuelCard(session.state, equip.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);

    const luaHost = createLuaScriptHost(session, workspace);
    for (const code of [earwigCode, equipCode, responderCode]) expect(luaHost.loadCardScript(Number(code), source).ok).toBe(true);
    expect(luaHost.registerInitialEffects()).toBe(3);
    expect(session.state.effects.filter((effect) => effect.sourceUid === earwig.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      value: effect.value,
    }))).toMatchObject([
      { code: undefined, event: "ignition", id: "lua-1", range: ["monsterZone"] },
      { code: 89785779, event: "continuous", id: "lua-2-89785779" },
      { code: 89785855, event: "continuous", id: "lua-3-89785855" },
      { code: 100, event: "continuous", id: "lua-4-100", value: 1000 },
      { code: 104, event: "continuous", id: "lua-5-104", value: 1000 },
      { code: 1015, event: "trigger", id: "lua-6-1015" },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === earwig.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: earwig.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x40000, targetUids: [], count: 1, player: 0, parameter: 18 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("inzektor earwig responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: earwig.uid,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: earwig.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === earwig.uid), restoredChain.session.state)).toBe(2000);
    expect(currentDefense(restoredChain.session.state.cards.find((card) => card.uid === earwig.uid), restoredChain.session.state)).toBe(2000);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === host.uid), restoredChain.session.state)).toBe(1500);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expectLuaProbe(restoredEquipped, "inzektor earwig probe 38450736/384507361/38450736/false/2000/2000");

    destroyDuelCard(restoredEquipped.session.state, equip.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: earwig.uid,
      previousController: 0,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === equip.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: equip.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: earwig.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredEquipped.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        eventName: "leftField",
        eventCode: 1015,
        eventCardUid: equip.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: earwig.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        sourceUid: equip.uid,
        effectId: "lua-12-1015",
        effectLabelObjectUid: earwig.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === equip.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === earwig.uid), restoredTrigger.session.state)).toBe(2000);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === earwig.uid), restoredTrigger.session.state)).toBe(1000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 100 && effect.sourceUid === earwig.uid && effect.reset !== undefined).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107169792 }, value: 1000 }]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: earwigCode, name: "Inzektor Earwig", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, setcodes: [setInzektor] },
    { code: hostCode, name: "Inzektor Earwig Host", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1200, setcodes: [setInzektor] },
    { code: equipCode, name: "Inzektor Earwig Equip", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 800, defense: 800, setcodes: [setInzektor] },
    { code: responderCode, name: "Inzektor Earwig Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createSession(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 38450736, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [earwigCode, hostCode, equipCode] }, 1: { main: [responderCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
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

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("inzektor earwig responder resolved") end)
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
      local earwig=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${earwigCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("inzektor earwig probe " .. tostring(earwig and earwig:GetCode()) .. "/" .. tostring(equip and equip:GetCode()) .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. earwig:GetAttack() .. "/" .. earwig:GetDefense())
    `,
    "inzektor-earwig-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
