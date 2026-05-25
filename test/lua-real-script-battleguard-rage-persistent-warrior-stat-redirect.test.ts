import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rageCode = "42233477";
const warriorCode = "422334770";
const nonWarriorCode = "422334771";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRageScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rageCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceThunder = 0x2000;
const effectUpdateAttack = 100;
const effectBattleDestroyRedirect = 204;
const eventLeaveField = 1015;
const locationHand = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasRageScript)("Lua real script Battleguard Rage persistent Warrior stat redirect", () => {
  it("restores persistent Warrior ATK gain, battle-destroy redirect, and target-leave self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rageCode}.lua`);
    expect(script).toContain("--Battleguard Rage");
    expect(script).toContain("aux.AddPersistentProcedure(c,0,aux.FaceupFilter(Card.IsRace,RACE_WARRIOR),CATEGORY_ATKCHANGE,EFFECT_FLAG_DAMAGE_STEP,TIMING_DAMAGE_STEP,TIMING_DAMAGE_STEP,aux.StatChangeDamageStepCondition)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(aux.PersistentTargetFilter)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e2:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)");
    expect(script).toContain("e2:SetValue(LOCATION_HAND)");
    expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 42233477, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rageCode, warriorCode, nonWarriorCode] }, 1: { main: [] } });
    startDuel(session);

    const rage = requireCard(session, rageCode);
    const warrior = requireCard(session, warriorCode);
    const nonWarrior = requireCard(session, nonWarriorCode);
    moveFaceUpTrap(session, rage, 0, 0, warrior.uid);
    moveFaceUpAttack(session, warrior, 0, 0);
    moveFaceUpAttack(session, nonWarrior, 0, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expectPersistentProbe(restored, "battleguard rage persistent true/true/1/2800/1200");
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === warrior.uid), restored.session.state)).toBe(2800);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonWarrior.uid), restored.session.state)).toBe(1200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rage.uid && [effectUpdateAttack, effectBattleDestroyRedirect, eventLeaveField].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["spellTrapZone"], targetRange: [4, 4], value: 1000 },
      { code: effectBattleDestroyRedirect, event: "continuous", range: ["spellTrapZone"], targetRange: [4, 4], value: locationHand },
      { code: eventLeaveField, event: "continuous", range: ["spellTrapZone"], targetRange: undefined, value: undefined },
    ]);

    destroyDuelCard(restored.session.state, warrior.uid, warrior.controller, duelReason.effect | duelReason.destroy, 0);
    expect(restored.session.state.cards.find((card) => card.uid === rage.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: rage.uid,
      reasonEffectId: 5,
    });

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rageCode, name: "Battleguard Rage", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: warriorCode, name: "Battleguard Rage Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
    { code: nonWarriorCode, name: "Battleguard Rage Non-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, targetUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceDown";
  moved.cardTargetUids = [targetUid];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function expectPersistentProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, message: string): void {
  const probe = restored.host.loadScript(
    `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${rageCode}),0,LOCATION_SZONE,0,nil)
      local warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${warriorCode}),0,LOCATION_MZONE,0,nil)
      local other=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${nonWarriorCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(trap)
      Debug.Message(
        "battleguard rage persistent " ..
        tostring(trap:IsHasCardTarget(warrior)) .. "/" ..
        tostring(aux.PersistentTargetFilter(e,warrior)) .. "/" ..
        trap:GetCardTargetCount() .. "/" ..
        warrior:GetAttack() .. "/" ..
        other:GetAttack()
      )
    `,
    "battleguard-rage-persistent-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(message);
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
