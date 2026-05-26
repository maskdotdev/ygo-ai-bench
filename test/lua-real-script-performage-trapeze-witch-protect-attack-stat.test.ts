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
const witchCode = "33206889";
const allyCode = "332068890";
const attackerCode = "332068891";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWitchScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${witchCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setPerformage = 0xc6;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasWitchScript)("Lua real script Performage Trapeze Witch protect attack stat", () => {
  it("restores Performage protection effects and attack-announcement ATK drop", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${witchCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 33206889, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [allyCode], extra: [witchCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const witch = requireCard(session, witchCode);
    const ally = requireCard(session, allyCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, witch, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(witchCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(witch.data).toMatchObject({ fusionMaterialMin: 2, fusionMaterialMax: 2, fusionMaterialSetcode: setPerformage });

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === witch.uid)?.data).toMatchObject({
      fusionMaterialMin: 2,
      fusionMaterialMax: 2,
      fusionMaterialSetcode: setPerformage,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === witch.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: witch.uid, targetRange: undefined, value: undefined },
      { code: 71, event: "continuous", property: 128, range: ["monsterZone"], sourceUid: witch.uid, targetRange: [4, 0], value: undefined },
      { code: 41, event: "continuous", property: 0, range: ["monsterZone"], sourceUid: witch.uid, targetRange: [4, 0], value: undefined },
      { code: 70, event: "continuous", property: 131072, range: ["monsterZone"], sourceUid: witch.uid, targetRange: undefined, value: undefined },
      { code: 1130, event: "trigger", property: undefined, range: ["monsterZone"], sourceUid: witch.uid, targetRange: undefined, value: undefined },
    ]);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === witch.uid
    )).toBe(false);

    const attack = getLuaRestoreLegalActions(restoredOpen, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === ally.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-5-1130",
        sourceUid: witch.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventUids: [attacker.uid, ally.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const trigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === witch.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, trigger!);
    resolveRestoredChain(restoredAttack);

    expect(currentAttack(findCard(restoredAttack.session, attacker.uid), restoredAttack.session.state)).toBe(1800);
    expect(currentAttack(findCard(restoredAttack.session, ally.uid), restoredAttack.session.state)).toBe(1200);
    expect(currentAttack(findCard(restoredAttack.session, witch.uid), restoredAttack.session.state)).toBe(2400);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 1024, reset: { flags: 33427456 }, sourceUid: attacker.uid, value: -600 },
    ]);

    const restoredStats = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredStats);
    expectRestoredLegalActions(restoredStats, 1);
    expect(currentAttack(findCard(restoredStats.session, attacker.uid), restoredStats.session.state)).toBe(1800);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Performage Trapeze Witch");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_PERFORMAGE),2)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_PERFORMAGE))");
  expect(script).toContain("e1:SetValue(aux.tgoval)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e2:SetValue(aux.indsval)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
  expect(script).toContain("e3:SetCondition(s.cannotatkcon)");
  expect(script).toContain("e3:SetValue(aux.imval2)");
  expect(script).toContain("e4:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("local bc0,bc1=Duel.GetBattleMonster(tp)");
  expect(script).toContain("bc0:IsSetCard(SET_PERFORMAGE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,bc1,1,tp,-600)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-600)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: witchCode, name: "Performage Trapeze Witch", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeDark, setcodes: [setPerformage], level: 7, attack: 2400, defense: 1800 },
    { code: allyCode, name: "Trapeze Witch Performage Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, setcodes: [setPerformage], level: 4, attack: 1200, defense: 1000 },
    { code: attackerCode, name: "Trapeze Witch Attack Announcer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
