import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gaapCode = "37955049";
const fiendOneCode = "379550490";
const fiendTwoCode = "379550491";
const warriorCode = "379550492";
const opponentCode = "379550493";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGaapScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gaapCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceFiend = 0x8;
const effectUpdateAttack = 100;
const effectCannotChangePosition = 14;
const effectSetPosition = 140;

describe.skipIf(!hasUpstreamScripts || !hasGaapScript)("Lua real script Gaap position reveal attack stat", () => {
  it("restores all-monster attack position lock and Fiend reveal count ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gaapCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = createRestoredMain({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const gaap = requireCard(restored.session, gaapCode);
    const fiendOne = requireCard(restored.session, fiendOneCode);
    const fiendTwo = requireCard(restored.session, fiendTwoCode);
    const warrior = requireCard(restored.session, warriorCode);
    const opponent = requireCard(restored.session, opponentCode);

    expect(restored.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpDefense",
    });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "changePosition" && action.uid === opponent.uid)).toBe(false);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gaap.uid && (effect.code === effectSetPosition || effect.code === effectCannotChangePosition)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectSetPosition, event: "continuous", targetRange: [4, 4], value: 65537 },
      { code: effectCannotChangePosition, event: "continuous", targetRange: [4, 4], value: 65537 },
    ]);
    const positionProbe = restored.host.loadScript(positionProbeScript(opponentCode), "gaap-position-probe.lua");
    expect(positionProbe.ok, positionProbe.error).toBe(true);
    expect(restored.host.messages).toContain("gaap position true/false/false");

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === gaap.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.session.state.cards.find((card) => card.uid === fiendOne.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fiendTwo.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(currentAttack(findCard(restored.session, gaap.uid), restored.session.state)).toBe(2800);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gaap.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169792 }, sourceUid: gaap.uid, value: 600 },
    ]);

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredBoosted);
    expectRestoredLegalActions(restoredBoosted, 0);
    expect(currentAttack(findCard(restoredBoosted.session, gaap.uid), restoredBoosted.session.state)).toBe(2800);
    expect(getLuaRestoreLegalActions(restoredBoosted, 1).some((action) => action.type === "changePosition" && action.uid === opponent.uid)).toBe(false);
    expect(restoredBoosted.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gaapCode, name: "Gaap the Divine Soldier", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 6, attack: 2200, defense: 2000 },
    { code: fiendOneCode, name: "Gaap Fixture Fiend One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
    { code: fiendTwoCode, name: "Gaap Fixture Fiend Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
    { code: warriorCode, name: "Gaap Fixture Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: opponentCode, name: "Gaap Fixture Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1600, defense: 1200 },
  ];
}

function createRestoredMain({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 37955049, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gaapCode, fiendOneCode, fiendTwoCode, warriorCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, gaapCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, fiendOneCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, fiendTwoCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, warriorCode).uid, "hand", 0);
  const opponent = moveDuelCard(session.state, requireCard(session, opponentCode).uid, "monsterZone", 1);
  opponent.sequence = 0;
  opponent.faceUp = true;
  opponent.position = "faceUpDefense";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gaapCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gaap the Divine Soldier");
  expect(script).toContain("e1:SetCode(EFFECT_SET_POSITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE)");
  expect(script).toContain("e1:SetValue(POS_FACEUP_ATTACK+NO_FLIP_EFFECT)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
  expect(script).toContain("return c:IsRace(RACE_FIEND) and not c:IsPublic()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,63,nil)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("e:SetLabel(#g)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()*300)");
}

function positionProbeScript(code: string): string {
  return `
    local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${code}),0,0,LOCATION_MZONE,nil)
    Debug.Message(
      "gaap position " ..
      tostring(c and c:IsAttackPos()) .. "/" ..
      tostring(c and c:IsDefensePos()) .. "/" ..
      tostring(c and c:IsCanChangePosition(POS_FACEUP_DEFENSE))
    )
  `;
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
