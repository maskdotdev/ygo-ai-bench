import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const spiritCode = "71939275";
const hasSpiritScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiritCode}.lua`));
const equippedCode = "719392750";
const defenderCode = "719392751";
const responderCode = "719392752";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const typeEffect = 0x20;
const raceZombie = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSpiritScript)("Lua real script Spirit Illusion equip attack announce stat", () => {
  it("restores equipped attack-announcement target into opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${spiritCode}.lua`);
    expect(script).toContain("aux.AddEquipProcedure(c,nil,s.eqfilter)");
    expect(script).toContain("return c:IsLevelAbove(5) and c:IsRace(RACE_FIEND|RACE_ZOMBIE)");
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("local at,bt=Duel.GetBattleMonster(tp)");
    expect(script).toContain("local ec=e:GetHandler():GetEquipTarget()");
    expect(script).toContain("Duel.SetTargetCard(bt)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,bt,1,tp,-e:GetHandler():GetEquipTarget():GetAttack())");
    expect(script).toContain("local bc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-atk)");
    expect(script).toContain("Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.CreateToken(tp,id+1)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 71939275, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spiritCode, equippedCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const spirit = requireCard(session, spiritCode);
    const equipped = requireCard(session, equippedCode);
    const defender = requireCard(session, defenderCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpEquip(session, spirit, 0, equipped.uid);
    moveFaceUpAttack(session, equipped, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [spiritCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === spirit.uid).map((effect) => ({
      id: effect.id,
      event: effect.event,
      code: effect.code,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { id: "lua-1-1002", event: "ignition", code: 1002, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { id: "lua-2-76", event: "continuous", code: 76, range: ["spellTrapZone"], triggerEvent: undefined },
      { id: "lua-3-1130", event: "trigger", code: 1130, range: ["spellTrapZone"], triggerEvent: "attackDeclared" },
      { id: "lua-4", event: "ignition", code: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === equipped.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1130",
        eventCardUid: equipped.uid,
        eventName: "attackDeclared",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: spirit.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === spirit.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3-1130",
        sourceUid: spirit.uid,
        player: 0,
        eventName: "attackDeclared",
        eventCode: 1130,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventCardUid: equipped.uid,
        eventUids: [equipped.uid, defender.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [defender.fieldId],
        targetUids: [defender.uid],
        operationInfos: [{ category: 0x200000, targetUids: [defender.uid], count: 1, player: 0, parameter: -2400 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("spirit illusion responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === equipped.uid), restoredChain.session.state)).toBe(2400);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === defender.uid), restoredChain.session.state)).toBe(600);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, event: "continuous", property: 0x400, reset: { flags: 33427456 }, value: -2400 }]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 1);
    expect(restoredStat.session.state.cards.find((card) => card.uid === spirit.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: equipped.uid });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === defender.uid), restoredStat.session.state)).toBe(600);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: spiritCode, name: "Spirit Illusion", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: equippedCode, name: "Spirit Illusion Equipped Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 6, attack: 2400, defense: 1000 },
    { code: defenderCode, name: "Spirit Illusion Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
    { code: responderCode, name: "Spirit Illusion Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("spirit illusion responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
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
