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
const necrossCode = "12600382";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNecrossScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${necrossCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const exodiaPartCodes = ["8124921", "44519536", "70903634", "7902349", "33396948"];
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasNecrossScript)("Lua real script Exodia Necross standby persistent stat", () => {
  it("restores protected Exodia Necross Standby trigger into persistent ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${necrossCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredDraw = createRestoredNecrossDraw({ reader, workspace });
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);

    const necross = requireCard(restoredDraw.session, necrossCode);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-3-1",
        effectId: "lua-5-4098",
        sourceUid: necross.uid,
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === necross.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.host.promptDecisions).toEqual([]);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(currentAttack(findCard(restoredTrigger.session, necross.uid), restoredTrigger.session.state)).toBe(2300);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === necross.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x2000, reset: { flags: 33492992 }, sourceUid: necross.uid, value: 500 },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(findCard(restoredPersistent.session, necross.uid), restoredPersistent.session.state)).toBe(2300);
    expect(restoredPersistent.session.state.cards.filter((card) => exodiaPartCodes.includes(card.code)).map((card) => ({
      code: card.code,
      controller: card.controller,
      location: card.location,
    }))).toEqual(exodiaPartCodes.map((code) => ({ code, controller: 0, location: "graveyard" })));
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: necrossCode, name: "Exodia Necross", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1800, defense: 0 },
    ...exodiaPartCodes.map((code) => ({ code, name: `Exodia Necross Grave Part ${code}`, kind: "monster" as const, typeFlags: typeMonster, race: raceSpellcaster, attribute: attributeDark, level: 1, attack: 200, defense: 300 })),
  ];
}

function createRestoredNecrossDraw({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 12600382, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [necrossCode, ...exodiaPartCodes] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, necrossCode), 0, 0);
  for (const code of exodiaPartCodes) {
    moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0).faceUp = true;
  }
  session.state.turn = 2;
  session.state.turnPlayer = 0;
  session.state.phase = "draw";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(necrossCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Exodia Necross");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e3:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("return tp==Duel.GetTurnPlayer()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e5:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return not Duel.IsExistingMatchingCard(Card.IsCode,p,LOCATION_GRAVE,0,1,nil,8124921)");
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
