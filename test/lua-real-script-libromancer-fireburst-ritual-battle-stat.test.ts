import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { registerDuelFlagEffect } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const fireburstCode = "88106656";
const costCode = "881066560";
const defenderCode = "881066561";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFireburstScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fireburstCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const setLibromancer = 0x17d;
const effectUpdateAttack = 100;
const effectIndestructableBattle = 42;
const effectExtraAttackMonster = 346;
const effectChangeBattleDamage = 208;

describe.skipIf(!hasUpstreamScripts || !hasFireburstScript)("Lua real script Libromancer Fireburst ritual battle stat", () => {
  it("restores ritual material battle modifiers and attack-announce banish ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${fireburstCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 88106656, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fireburstCode, costCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const fireburst = requireCard(session, fireburstCode);
    const cost = requireCard(session, costCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, fireburst, 0, 0);
    fireburst.summonType = "ritual";
    registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: fireburst.uid }, Number(fireburstCode), 0x1fe1000, 0x40, 0, 1);
    moveDuelCard(session.state, cost.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fireburstCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fireburst.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: fireburst.uid, value: undefined },
      { code: 251, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: fireburst.uid, value: undefined },
      { code: effectIndestructableBattle, event: "continuous", property: 131072, range: ["monsterZone"], sourceUid: fireburst.uid, value: 1 },
      { code: effectChangeBattleDamage, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: fireburst.uid, value: undefined },
      { code: effectExtraAttackMonster, event: "continuous", property: 131072, range: ["monsterZone"], sourceUid: fireburst.uid, value: 1 },
      { code: 1130, event: "trigger", property: undefined, range: ["monsterZone"], sourceUid: fireburst.uid, value: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === fireburst.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    const trigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === fireburst.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, trigger!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: fireburst.uid,
      reasonEffectId: 6,
    });
    expect(currentAttack(findCard(restoredOpen.session, fireburst.uid), restoredOpen.session.state)).toBe(3000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fireburst.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: fireburst.uid, value: 200 },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    finishBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 4000 });
    expect(restoredBoost.session.state.players[1].lifePoints).toBe(4000);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: fireburst.uid,
        eventPlayer: 1,
        eventValue: 4000,
        eventReason: duelReason.battle,
        eventReasonCardUid: fireburst.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Libromancer Fireburst");
  expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("c:GetMaterial():IsExists(Card.IsLocation,1,nil,LOCATION_MZONE)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD&~RESET_TOFIELD),EFFECT_FLAG_CLIENT_HINT,1,0,aux.Stringid(id,0))");
  expect(script).toContain("return c:IsRitualSummoned() and c:GetFlagEffect(id)>0");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
  expect(script).toContain("e2:SetValue(aux.ChangeBattleDamage(1,DOUBLE_DAMAGE))");
  expect(script).toContain("e3:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
  expect(script).toContain("e4:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return c:IsRitualMonster() and c:IsSetCard(SET_LIBROMANCER) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,c)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: fireburstCode, name: "Libromancer Fireburst", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceCyberse, attribute: attributeFire, setcodes: [setLibromancer], level: 7, attack: 2800, defense: 2800 },
    { code: costCode, name: "Libromancer Fireburst Ritual Cost", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceCyberse, attribute: attributeFire, setcodes: [setLibromancer], level: 4, attack: 1800, defense: 1000 },
    { code: defenderCode, name: "Libromancer Fireburst Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
