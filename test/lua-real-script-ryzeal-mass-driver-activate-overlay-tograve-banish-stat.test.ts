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
const driverCode = "53276089";
const ryzealXyzCode = "532760890";
const ryzealMonsterCode = "532760891";
const opponentGraveCode = "532760892";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDriverScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${driverCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setRyzeal = 0x1b6;
const racePyro = 0x80;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDriverScript)("Lua real script Ryzeal Mass Driver activate overlay tograve banish stat", () => {
  it("restores activation ATK grant optional overlay attachment and non-field to-grave banish trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${driverCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredActivation = createRestoredActivationField({ reader, workspace });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const driver = requireCard(restoredActivation.session, driverCode);
    const ryzealXyz = requireCard(restoredActivation.session, ryzealXyzCode);
    const ryzealMonster = requireCard(restoredActivation.session, ryzealMonsterCode);
    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === driver.uid && action.effectId === "lua-1-1002");
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activate!);
    resolveRestoredChain(restoredActivation);

    expect(restoredActivation.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 852417427, returned: true });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === ryzealXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      overlayUids: [driver.uid],
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === driver.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: driver.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === ryzealXyz.uid), restoredActivation.session.state)).toBe(3500);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === ryzealMonster.uid), restoredActivation.session.state)).toBe(2800);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, controller: 0, reset: { flags: 1073742336 }, sourceUid: driver.uid, targetRange: [4, 0], value: 1000 },
    ]);

    const restoredToGraveOpen = createRestoredToGraveField({ reader, workspace });
    expectCleanRestore(restoredToGraveOpen);
    expectRestoredLegalActions(restoredToGraveOpen, 0);
    const graveDriver = requireCard(restoredToGraveOpen.session, driverCode);
    const opponentGrave = requireCard(restoredToGraveOpen.session, opponentGraveCode);
    sendDuelCardToGraveyard(restoredToGraveOpen.session.state, graveDriver.uid, 0, duelReason.effect, 0);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredToGraveOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1014", eventCardUid: graveDriver.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, player: 0, sourceUid: graveDriver.uid, triggerBucket: "turnOptional" },
    ]);
    const banish = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === graveDriver.uid && action.effectId === "lua-2-1014");
    expect(banish, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, banish!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentGrave.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveDriver.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredActivationField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 53276089, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [driverCode, ryzealMonsterCode], extra: [ryzealXyzCode] }, 1: { main: [opponentGraveCode] } });
  startDuel(session);
  moveSetSpellTrap(session, requireCard(session, driverCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ryzealXyzCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ryzealMonsterCode), 0, 1);
  moveDuelCard(session.state, requireCard(session, opponentGraveCode).uid, "graveyard", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerDriver(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
}

function createRestoredToGraveField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 53276090, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [driverCode] }, 1: { main: [opponentGraveCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, driverCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, opponentGraveCode).uid, "graveyard", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerDriver(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerDriver(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(driverCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ryzeal Mass Driver");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(function() return not (Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()) end)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_RYZEAL),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,#g,tp,1000)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("aux.RegisterClientHint(c,0,tp,1,0,aux.Stringid(id,2))");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,3))");
  expect(script).toContain("c:CancelToGrave()");
  expect(script).toContain("Duel.Overlay(tc,c)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return not e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToRemove,tp,0,LOCATION_GRAVE,1,1,nil)");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const driver = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === driverCode);
  expect(driver).toBeDefined();
  return [
    driver!,
    { code: ryzealXyzCode, name: "Ryzeal Mass Driver Rank 4 Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setRyzeal], race: racePyro, attribute: attributeFire, level: 4, attack: 2500, defense: 2000, xyzMaterialCount: 2 },
    { code: ryzealMonsterCode, name: "Ryzeal Mass Driver Ryzeal Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setRyzeal], race: racePyro, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
    { code: opponentGraveCode, name: "Ryzeal Mass Driver Opponent Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveSetSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
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
