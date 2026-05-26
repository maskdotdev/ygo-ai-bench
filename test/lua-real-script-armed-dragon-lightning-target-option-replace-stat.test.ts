import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const lightningCode = "97091969";
const highDragonCode = "970919690";
const lowDragonCode = "970919691";
const decoyCode = "970919692";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLightningScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lightningCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const setArmedDragon = 0x111;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLightningScript)("Lua real script Armed Dragon Lightning target option replace stat", () => {
  it("restores targeted ATK option, grave-to-hand option, and Armed Dragon destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lightningCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const boost = createRestoredScenario("boost", workspace, reader);
    expectRestoredLegalActions(boost.restored, 0);
    const boostAction = actionFor(boost.restored, boost.lightning.uid);
    applyRestoredActionAndAssert(boost.restored, boostAction);
    resolveRestoredChain(boost.restored);
    expect(currentAttack(findCard(boost.restored.session, boost.highDragon.uid), boost.restored.session.state)).toBe(3500);
    expect(boost.restored.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectOption", player: 0, returned: 0 }]);
    expect(boost.restored.session.state.effects.filter((effect) => effect.sourceUid === boost.highDragon.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: boost.highDragon.uid, value: 700 },
    ]);
    expect(boost.restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: boost.highDragon.uid, eventCode: 1028, eventName: "becameTarget", eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const toHand = createRestoredScenario("toHand", workspace, reader, { promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }] });
    expectRestoredLegalActions(toHand.restored, 0);
    const toHandAction = actionFor(toHand.restored, toHand.lightning.uid);
    applyRestoredActionAndAssert(toHand.restored, toHandAction);
    resolveRestoredChain(toHand.restored);
    expect(currentAttack(findCard(toHand.restored.session, toHand.highDragon.uid), toHand.restored.session.state)).toBe(2800);
    expect(findCard(toHand.restored.session, toHand.lowDragon.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: toHand.lightning.uid,
      reasonEffectId: 2,
    });
    expect(toHand.restored.host.messages).toContain(`confirmed 1: ${lowDragonCode}`);
    expect(toHand.restored.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectOption", player: 0, returned: 1 }]);
    expect(toHand.restored.session.state.eventHistory.filter((event) =>
      ["becameTarget", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: toHand.highDragon.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: toHand.lowDragon.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: toHand.lightning.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: toHand.lowDragon.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: toHand.lightning.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: toHand.lowDragon.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: toHand.lightning.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);

    const replacement = createRestoredScenario("replacement", workspace, reader);
    expectRestoredLegalActions(replacement.restored, 0);
    destroyDuelCard(replacement.restored.session.state, replacement.highDragon.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(replacement.restored.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true });
    expect(findCard(replacement.restored.session, replacement.highDragon.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(findCard(replacement.restored.session, replacement.lightning.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: replacement.lightning.uid,
      reasonEffectId: 3,
    });
    expect(replacement.restored.session.state.log).toContainEqual(expect.objectContaining({ action: "destroyReplace", player: 0, card: findCard(replacement.restored.session, replacement.highDragon.uid).name, detail: "Destruction replaced" }));
    expect(replacement.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredScenario(
  scenario: string,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
  options?: Parameters<typeof restoreDuelWithLuaScripts>[3],
): { restored: ReturnType<typeof restoreDuelWithLuaScripts>; lightning: DuelCardInstance; highDragon: DuelCardInstance; lowDragon: DuelCardInstance } {
  const session = createDuel({ seed: Number(lightningCode) + scenario.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lightningCode, highDragonCode, lowDragonCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);

  const lightning = requireCard(session, lightningCode);
  const highDragon = requireCard(session, highDragonCode);
  const lowDragon = requireCard(session, lowDragonCode);
  moveFaceUpSpell(session, lightning);
  moveFaceUpMonster(session, highDragon);
  moveDuelCard(session.state, lowDragon.uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace, options);
  const loaded = host.loadCardScript(Number(lightningCode), workspace);
  expect(loaded.ok, loaded.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, options);
  expectCleanRestore(restored);
  return { restored, lightning, highDragon, lowDragon };
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const lightning = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === lightningCode);
  expect(lightning).toBeDefined();
  return [
    { ...lightning!, kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: highDragonCode, name: "Armed Dragon Lightning LV7 Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2800, defense: 1000, setcodes: [setArmedDragon] },
    { code: lowDragonCode, name: "Armed Dragon Lightning GY LV3", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1200, defense: 900, setcodes: [setArmedDragon] },
    { code: decoyCode, name: "Armed Dragon Lightning Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.optfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,1),aux.Stringid(id,2))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(val)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil,tc:GetLevel())");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
  expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)");
}

function actionFor(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): DuelAction {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
    candidate.type === "activateEffect" && candidate.uid === uid && candidate.effectId === "lua-2"
  );
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
