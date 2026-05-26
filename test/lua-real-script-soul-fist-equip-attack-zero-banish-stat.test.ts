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
const soulFistCode = "69533836";
const redDragonCode = "70902743";
const opponentACode = "695338360";
const opponentBCode = "695338361";
const graveMonsterCode = "695338362";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSoulFistScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${soulFistCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectImmune = 1;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSoulFistScript)("Lua real script Soul Fist equip attack zero banish stat", () => {
  it("restores equipped immunity, opponent ATK setting, and attack-announcement grave banish ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${soulFistCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredEquippedField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const soulFist = requireCard(restoredOpen.session, soulFistCode);
    const redDragon = requireCard(restoredOpen.session, redDragonCode);
    const opponentA = requireCard(restoredOpen.session, opponentACode);
    const opponentB = requireCard(restoredOpen.session, opponentBCode);
    const graveMonster = requireCard(restoredOpen.session, graveMonsterCode);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === soulFist.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: redDragon.uid,
      cardTargetUids: [redDragon.uid],
      faceUp: true,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === soulFist.uid && effect.code === effectImmune).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectImmune, event: "continuous", range: ["spellTrapZone"], sourceUid: soulFist.uid },
    ]);

    const setAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === soulFist.uid && action.effectId === "lua-4"
    );
    expect(setAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setAttack!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentA.uid), restoredOpen.session.state)).toBe(3000);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentB.uid), restoredOpen.session.state)).toBe(3000);
    expect(restoredOpen.session.state.effects.filter((effect) => [opponentA.uid, opponentB.uid].includes(effect.sourceUid) && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 33427456 }, sourceUid: opponentA.uid, value: 3000 },
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 33427456 }, sourceUid: opponentB.uid, value: 3000 },
    ]);

    restoredOpen.session.state.effects = restoredOpen.session.state.effects.filter((effect, index, effects) =>
      effects.findIndex((candidate) => candidate.sourceUid === effect.sourceUid && candidate.id === effect.id) === index
    );
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === redDragon.uid && action.targetUid === opponentA.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1130", eventCardUid: redDragon.uid, eventCode: 1130, eventName: "attackDeclared", eventPlayer: 0, player: 0, sourceUid: soulFist.uid, triggerBucket: "turnOptional" },
    ]);

    restoredBattle.session.state.effects = restoredBattle.session.state.effects.filter((effect, index, effects) =>
      effects.findIndex((candidate) => candidate.sourceUid === effect.sourceUid && candidate.id === effect.id) === index
    );
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === soulFist.uid && action.effectId === "lua-5-1130"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === graveMonster.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: soulFist.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === redDragon.uid), restoredTrigger.session.state)).toBe(4200);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === redDragon.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: redDragon.uid, value: 1200 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: redDragon.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveMonster.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "graveyard" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveMonster.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: soulFist.uid, eventReasonEffectId: 5, previous: "graveyard", current: "banished" },
    ]);
    finishRestoredBattle(restoredTrigger);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 });
  });
});

function createRestoredEquippedField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 69533836, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [soulFistCode, redDragonCode] }, 1: { main: [opponentACode, opponentBCode, graveMonsterCode] } });
  startDuel(session);
  const soulFist = requireCard(session, soulFistCode);
  const redDragon = moveFaceUpAttack(session, requireCard(session, redDragonCode), 0, 0);
  moveFaceUpEquip(session, soulFist, 0, redDragon.uid);
  moveFaceUpAttack(session, requireCard(session, opponentACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentBCode), 1, 1);
  moveDuelCard(session.state, requireCard(session, graveMonsterCode).uid, "graveyard", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(soulFistCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Soul Fist");
  expect(script).toContain("aux.AddEquipProcedure(c,0,s.eqfilter)");
  expect(script).toContain("return c:IsRace(RACE_DRAGON) and c:IsType(TYPE_SYNCHRO)");
  expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
  expect(script).toContain("return ec and ec:IsCode(CARD_RED_DRAGON_ARCHFIEND)");
  expect(script).toContain("te:GetOwnerPlayer()==1-e:GetHandlerPlayer() and te:IsActivated()");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(aux.NOT(Card.IsAttack),atk),tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e3:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e:GetHandler():GetEquipTarget():IsRelateToBattle()");
  expect(script).toContain("Duel.SelectTarget(tp,aux.AND(Card.IsMonster,Card.IsAbleToRemove),tp,0,LOCATION_GRAVE,1,1,nil)");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const soulFist = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === soulFistCode);
  expect(soulFist).toBeDefined();
  return [
    soulFist!,
    { code: redDragonCode, name: "Red Dragon Archfiend", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, attribute: attributeDark, level: 8, attack: 3000, defense: 2000 },
    { code: opponentACode, name: "Soul Fist Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: opponentBCode, name: "Soul Fist Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
    { code: graveMonsterCode, name: "Soul Fist Grave Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, equippedToUid: string): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
