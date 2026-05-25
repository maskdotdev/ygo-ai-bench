import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bearblockerCode = "80141055";
const setCardCode = "801410550";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBearblockerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bearblockerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectIndestructibleEffect = 41;

describe.skipIf(!hasUpstreamScripts || !hasBearblockerScript)("Lua real script Bearblocker set destroyed stat protect", () => {
  it("restores set Spell/Trap protection metadata and opponent destroyed trigger into ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bearblockerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredBearblockerOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const bearblocker = requireCard(restoredOpen.session, bearblockerCode);
    const setCard = requireCard(restoredOpen.session, setCardCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === bearblocker.uid && effect.code === effectIndestructibleEffect).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleEffect, property: 0x100, range: ["monsterZone"], sourceUid: bearblocker.uid, targetRange: [8, 0], value: 1 },
    ]);

    destroyDuelCard(restoredOpen.session.state, setCard.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === setCard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-2-1029",
        eventCardUid: setCard.uid,
        eventCode: 1029,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventName: "destroyed",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        id: "trigger-3-1",
        player: 0,
        sourceUid: bearblocker.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === bearblocker.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, bearblocker.uid), restoredTrigger.session.state)).toBe(2400);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === bearblocker.uid && [effectIndestructibleEffect, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleEffect, property: 0x100, range: ["monsterZone"], reset: undefined, sourceUid: bearblocker.uid, targetRange: [8, 0], value: 1 },
      { code: effectUpdateAttack, property: undefined, range: ["monsterZone"], reset: { flags: 1107235328 }, sourceUid: bearblocker.uid, targetRange: undefined, value: 800 },
    ]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(findCard(restoredStat.session, bearblocker.uid), restoredStat.session.state)).toBe(2400);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: bearblockerCode, name: "Bearblocker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 3, attack: 1600, defense: 0 },
    { code: setCardCode, name: "Bearblocker Set Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function createRestoredBearblockerOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 80141055, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [bearblockerCode, setCardCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, bearblockerCode), 0, 0);
  moveSetSpellTrap(session, requireCard(session, setCardCode), 0, 0);
  session.state.turnPlayer = 0;
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(bearblockerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Bearblocker");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_SZONE,0)");
  expect(script).toContain("return Duel.GetTurnPlayer()~=e:GetHandlerPlayer()");
  expect(script).toContain("return c:GetSequence()<5 and c:IsFacedown()");
  expect(script).toContain("return c:IsPreviousLocation(LOCATION_SZONE) and c:IsPreviousPosition(POS_FACEDOWN)");
  expect(script).toContain("and c:IsPreviousControler(tp) and c:GetPreviousSequence()<5");
  expect(script).toContain("return eg:IsExists(s.filter,1,nil,tp) and rp~=tp");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(800)");
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

function moveSetSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
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
