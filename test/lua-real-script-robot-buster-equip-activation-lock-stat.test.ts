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
const robotCode = "38601126";
const busterBladerCode = "78193831";
const lockedSpellCode = "386011260";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts)("Lua real script Robot Buster equip activation lock stat", () => {
  it("restores self-equip, opponent Spell/Trap activation lock, and grave cost ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${robotCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_MZONE)");
    expect(script).toContain("return c:IsFaceup() and c:IsCode(CARD_BUSTER_BLADER)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.Equip(tp,c,tc,true)");
    expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ACTIVATE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("return loc==LOCATION_SZONE and not re:IsHasType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("Duel.SetTargetCard(tc)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${lockedSpellCode}.lua`) return lockedSpellScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 38601126, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [robotCode, busterBladerCode] }, 1: { main: [lockedSpellCode] } });
    startDuel(session);

    const robot = requireCard(session, robotCode);
    const busterBlader = requireCard(session, busterBladerCode);
    const lockedSpell = requireCard(session, lockedSpellCode);
    moveDuelCard(session.state, robot.uid, "hand", 0);
    moveFaceUpAttack(session, busterBlader, 0);
    moveDuelCard(session.state, lockedSpell.uid, "spellTrapZone", 1);
    lockedSpell.faceUp = true;
    lockedSpell.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(robotCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(lockedSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === robot.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === robot.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: busterBlader.uid,
      cardTargetUids: [busterBlader.uid],
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: robot.uid,
      reasonEffectId: 1,
    });

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === robot.uid && [6, 76].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      reset: effect.reset,
    }))).toEqual([
      { code: 6, property: 0x800, range: ["spellTrapZone"], targetRange: [0, 1], reset: undefined },
      { code: 76, property: 0x400, range: ["spellTrapZone"], targetRange: undefined, reset: { flags: 33427456 } },
    ]);
    expect(getLuaRestoreLegalActions(restoredEquipped, 1).some((action) => action.type === "activateEffect" && action.uid === lockedSpell.uid)).toBe(false);
    expect(restoredEquipped.host.messages).not.toContain("robot buster locked spell resolved");
    expectLuaProbe(restoredEquipped, "robot buster probe 38601126/78193831/true/2600");
    expect(restoredEquipped.host.messages).toContain("robot buster able grave cost true");
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === robot.uid).map((effect) => ({
      id: effect.id,
      registryKey: effect.registryKey,
      controller: effect.controller,
      event: effect.event,
      code: effect.code,
      range: effect.range,
      condition: effect.luaConditionDescriptor,
      cost: Boolean(effect.cost),
      target: Boolean(effect.target),
      luaCost: effect.luaCostDescriptor,
      luaTarget: effect.luaTargetDescriptor,
    }))).toEqual([
      { id: "lua-1", registryKey: "lua:38601126:lua-1", controller: 0, event: "ignition", code: undefined, range: ["hand", "monsterZone"], condition: undefined, cost: true, target: true, luaCost: undefined, luaTarget: undefined },
      { id: "lua-2-6", registryKey: "lua:38601126:lua-2-6", controller: 0, event: "continuous", code: 6, range: ["spellTrapZone"], condition: "condition:source-equipped", cost: true, target: true, luaCost: undefined, luaTarget: undefined },
      { id: "lua-3", registryKey: "lua:38601126:lua-3", controller: 0, event: "ignition", code: undefined, range: ["spellTrapZone"], condition: "condition:source-equipped", cost: true, target: true, luaCost: undefined, luaTarget: undefined },
      { id: "lua-5-76", registryKey: "lua:38601126:lua-5-76", controller: 0, event: "continuous", code: 76, range: ["spellTrapZone"], condition: undefined, cost: true, target: true, luaCost: undefined, luaTarget: undefined },
    ]);

    const statAction = getLuaRestoreLegalActions(restoredEquipped, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === robot.uid && action.effectId === "lua-3",
    );
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipped, statAction!);
    expect(restoredEquipped.session.state.chain).toEqual([]);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === robot.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: busterBlader.uid,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: robot.uid,
      reasonEffectId: 3,
    });
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === robot.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: robot.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: robot.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(currentAttack(restoredEquipped.session.state.cards.find((card) => card.uid === busterBlader.uid), restoredEquipped.session.state)).toBe(3600);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === busterBlader.uid), restoredStat.session.state)).toBe(3600);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === busterBlader.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107169792 }, value: 1000 }]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: robotCode, name: "Robot Buster Destruction Sword", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
    { code: busterBladerCode, name: "Buster Blader", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2600, defense: 2300 },
    { code: lockedSpellCode, name: "Robot Buster Locked Continuous Spell", kind: "spell", typeFlags: typeSpell, attack: 0, defense: 0 },
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

function lockedSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_SZONE)
      e:SetOperation(function(e,tp) Debug.Message("robot buster locked spell resolved") end)
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
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${robotCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("robot buster probe " .. tostring(equip and equip:GetCode()) .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. equipTarget:GetAttack())
      Debug.Message("robot buster able grave cost " .. tostring(equip and equip:IsAbleToGraveAsCost()))
    `,
    "robot-buster-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
