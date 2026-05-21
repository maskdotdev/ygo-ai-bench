import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardMatchesCode } from "#duel/card-code-state.js";
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
const gaiaCode = "15989522";
const gaiaChampionPasscode = "66889139";
const destroyTargetCode = "159895220";
const battleTargetCode = "159895221";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGaiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gaiaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x10;
const setGaiaFierceKnight = 0xbd;

describe.skipIf(!hasUpstreamScripts || !hasGaiaScript)("Lua real script Gaia Magical Knight code quick destroy battle stat", () => {
  it("restores Gaia Champion code change, quick ATK-spend destruction, and battle-destroying ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gaiaCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const restoredQuick = createRestoredQuickWindow({ reader, workspace });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quickGaia = requireCard(restoredQuick.session, gaiaCode);
    const destroyTarget = requireCard(restoredQuick.session, destroyTargetCode);
    const restoredQuickGaia = restoredQuick.session.state.cards.find((card) => card.uid === quickGaia.uid)!;
    expect(currentCardMatchesCode(restoredQuickGaia, restoredQuick.session.state, gaiaChampionPasscode)).toBe(true);
    expect(currentCardMatchesCode(restoredQuickGaia, restoredQuick.session.state, gaiaCode)).toBe(false);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === quickGaia.uid && effect.code === 114).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([{ code: 114, property: 0x20000, range: ["monsterZone"], value: Number(gaiaChampionPasscode) }]);

    const quickDestroy = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === quickGaia.uid);
    expect(quickDestroy, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    expect("operationInfos" in quickDestroy!).toBe(false);
    applyRestoredActionAndAssert(restoredQuick, quickDestroy!);
    expect(restoredQuick.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredQuick);

    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === quickGaia.uid), restoredQuick.session.state)).toBe(0);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: quickGaia.uid,
      reasonEffectId: 3,
    });
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: destroyTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: quickGaia.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    const restoredBattle = createRestoredBattleWindow({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleGaia = requireCard(restoredBattle.session, gaiaCode);
    const battleTarget = requireCard(restoredBattle.session, battleTargetCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleGaia.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattleUntilTrigger(restoredBattle);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleGaia.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === battleGaia.uid), restoredTrigger.session.state)).toBe(5200);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1600 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: battleGaia.uid,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "battleDestroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: battleTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: battleGaia.uid, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: battleTarget.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: battleGaia.uid, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function createRestoredQuickWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 15989522, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gaiaCode] }, 1: { main: [destroyTargetCode] } });
  startDuel(session);

  moveFaceUpAttack(session, requireCard(session, gaiaCode), 0);
  moveFaceUpAttack(session, requireCard(session, destroyTargetCode), 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gaiaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 15989523, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gaiaCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);

  moveFaceUpAttack(session, requireCard(session, gaiaCode), 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gaiaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GAIA_THE_FIERCE_KNIGHT),s.matfilter)");
  expect(script).toContain("return c:IsRace(RACE_DRAGON,fc,sumtype,tp) and c:IsLevel(5)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
  expect(script).toContain("e1:SetValue(CARD_GAIA_CHAMPION)");
  expect(script).toContain("return Duel.IsMainPhase() and e:GetHandler():GetAttack()>=2600");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
  expect(script).toContain("c:UpdateAttack(-2600,RESET_EVENT|RESETS_STANDARD,c)==-2600");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e3:SetCondition(aux.bdocon)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(2600)");
}

function cards(): DuelCardData[] {
  return [
    { code: gaiaCode, name: "Gaia the Magical Knight of Dragons", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceDragon, attribute: attributeDark, level: 7, attack: 2600, defense: 2100 },
    { code: destroyTargetCode, name: "Gaia Quick Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: battleTargetCode, name: "Gaia Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: "159895222", name: "Gaia Fierce Knight Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200, setcodes: [setGaiaFierceKnight] },
    { code: "159895223", name: "Gaia Dragon Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 5, attack: 1800, defense: 1500 },
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
