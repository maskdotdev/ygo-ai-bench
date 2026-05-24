import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const nayutaCode = "41410651";
const cyberseTargetCode = "414106510";
const warriorDecoyCode = "414106511";
const opponentCode = "414106512";
const mathmechCostCode = "414106513";
const mathmechRecoverCode = "414106514";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNayutaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nayutaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setMathmech = 0x132;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasNayutaScript)("Lua real script Mathmech Billionblade Nayuta equip cost to-hand stat", () => {
  it("restores Cyberse equip, pre-damage Mathmech Deck cost ATK gain, and previous-SZONE recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectNayutaScriptShape(workspace.readScript(`official/c${nayutaCode}.lua`));
    const reader = createCardReader(cards());

    const boost = createRestoredEquippedBattle({ reader, workspace });
    expectCleanRestore(boost);
    expectRestoredLegalActions(boost, 0);
    const nayuta = requireCard(boost.session, nayutaCode);
    const cyberse = requireCard(boost.session, cyberseTargetCode);
    const warrior = requireCard(boost.session, warriorDecoyCode);
    const opponent = requireCard(boost.session, opponentCode);
    const mathmechCost = requireCard(boost.session, mathmechCostCode);
    const equipAction = getLuaRestoreLegalActions(boost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === nayuta.uid
    );
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(boost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(boost, equipAction!);
    resolveRestoredChain(boost);

    const equipped = restoreDuelWithLuaScripts(serializeDuel(boost.session), workspace, reader);
    expectCleanRestore(equipped);
    expectRestoredLegalActions(equipped, 0);
    expect(equipped.session.state.cards.find((card) => card.uid === nayuta.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: cyberse.uid,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: nayuta.uid,
      reasonEffectId: 1,
    });
    expect(equipped.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({ location: "monsterZone" });
    expect(equipped.session.state.cards.find((card) => card.uid === warrior.uid)?.equippedToUid).toBeUndefined();

    equipped.session.state.phase = "battle";
    equipped.session.state.turnPlayer = 0;
    equipped.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(equipped, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === cyberse.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(equipped, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(equipped, attack!);
    passRestoredBattleUntil(equipped, () =>
      getLuaRestoreLegalActions(equipped, equipped.session.state.waitingFor ?? equipped.session.state.turnPlayer)
        .some((action) => action.type === "activateTrigger" && action.uid === nayuta.uid && action.effectId === "lua-3-1134")
    );

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(equipped.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    const damagePlayer = restoredDamage.session.state.waitingFor ?? restoredDamage.session.state.turnPlayer;
    expectRestoredLegalActions(restoredDamage, damagePlayer);
    const statTrigger = getLuaRestoreLegalActions(restoredDamage, damagePlayer).find((action) =>
      action.type === "activateTrigger" && action.uid === nayuta.uid && action.effectId === "lua-3-1134"
    );
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, damagePlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, statTrigger!);
    resolveRestoredChain(restoredDamage);

    expect(restoredDamage.session.state.cards.find((card) => card.uid === mathmechCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: nayuta.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredDamage.session.state.cards.find((card) => card.uid === cyberse.uid), restoredDamage.session.state)).toBe(3500);
    expect(restoredDamage.session.state.effects.filter((effect) =>
      effect.sourceUid === cyberse.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: cyberse.uid, value: 1800 },
    ]);
    expect(restoredDamage.session.state.eventHistory.filter((event) =>
      ["beforeDamageCalculation", "sentToGraveyard"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: cyberse.uid, eventCode: 1134, eventName: "beforeDamageCalculation", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: mathmechCost.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: nayuta.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
    expect(restoredDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const recovery = createRestoredPreviousSzoneRecovery({ reader, workspace });
    expectCleanRestore(recovery);
    expectRestoredLegalActions(recovery, 0);
    const recoveryNayuta = requireCard(recovery.session, nayutaCode);
    const recoverTarget = requireCard(recovery.session, mathmechRecoverCode);
    sendDuelCardToGraveyard(recovery.session.state, recoveryNayuta.uid, 0, duelReason.effect, 0);
    const recoveryTrigger = restoreDuelWithLuaScripts(serializeDuel(recovery.session), workspace, reader);
    expectCleanRestore(recoveryTrigger);
    expectRestoredLegalActions(recoveryTrigger, 0);
    expect(recoveryTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1014", eventCode: 1014, eventName: "sentToGraveyard", player: 0, sourceUid: recoveryNayuta.uid, triggerBucket: "turnOptional" },
    ]);
    const recover = getLuaRestoreLegalActions(recoveryTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === recoveryNayuta.uid && action.effectId === "lua-4-1014"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(recoveryTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(recoveryTrigger, recover!);
    resolveRestoredChain(recoveryTrigger);
    expect(recoveryTrigger.session.state.cards.find((card) => card.uid === recoverTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: recoveryNayuta.uid,
      reasonEffectId: 4,
    });
    expect(recoveryTrigger.session.state.eventHistory.filter((event) =>
      ["sentToGraveyard", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: recoveryNayuta.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "spellTrapZone", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: recoverTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "graveyard", relatedEffectId: 4 },
      { eventCardUid: recoverTarget.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: recoveryNayuta.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "hand", relatedEffectId: undefined },
    ]);
  });
});

function createRestoredEquippedBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 41410651, reader, workspace, main: [nayutaCode, cyberseTargetCode, warriorDecoyCode, mathmechCostCode], opponent: [opponentCode] });
  moveDuelCard(session.state, requireCard(session, nayutaCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, cyberseTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, warriorDecoyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredPreviousSzoneRecovery({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 41410652, reader, workspace, main: [nayutaCode, cyberseTargetCode, mathmechRecoverCode], opponent: [] });
  const nayuta = requireCard(session, nayutaCode);
  const cyberse = moveFaceUpAttack(session, requireCard(session, cyberseTargetCode), 0, 0);
  const placed = moveDuelCard(session.state, nayuta.uid, "spellTrapZone", 0);
  placed.faceUp = true;
  placed.equippedToUid = cyberse.uid;
  moveFaceUpGrave(session, requireCard(session, mathmechRecoverCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main,
  opponent,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main: string[];
  opponent: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: opponent } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(nayutaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function cards(): DuelCardData[] {
  return [
    { code: nayutaCode, name: "Mathmech Billionblade Nayuta", kind: "spell", typeFlags: typeSpell | typeEquip, setcodes: [setMathmech] },
    { code: cyberseTargetCode, name: "Nayuta Cyberse Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: warriorDecoyCode, name: "Nayuta Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
    { code: opponentCode, name: "Nayuta Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
    { code: mathmechCostCode, name: "Nayuta Mathmech Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000, setcodes: [setMathmech] },
    { code: mathmechRecoverCode, name: "Nayuta Mathmech Recover Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000, setcodes: [setMathmech] },
  ];
}

function expectNayutaScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mathmech Billionblade Nayuta");
  expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsRace,RACE_CYBERSE))");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetRange(LOCATION_SZONE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_DECK,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_COST)");
  expect(script).toContain("e:SetLabel(tc:GetAttack())");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_SZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
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

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.chain.length > 0
      ? "passChain"
      : restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation"
        ? "passDamage"
        : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify({ player, battleStep: restored.session.state.battleStep, actions: getLuaRestoreLegalActions(restored, player) }, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
