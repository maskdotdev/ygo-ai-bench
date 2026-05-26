import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const vambraceCode = "36247316";
const targetCode = "362473160";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasVambraceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vambraceCode}.lua`));
const setPhantomKnights = 0x10db;
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectChangeLevel = 131;
const effectIndestructableBattle = 42;
const resetStandardPhaseEnd = 1107169792;
const resetPhaseEnd = 1073742336;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasVambraceScript)("Lua real script The Phantom Knights of Lost Vambrace target step stat", () => {
  it("restores Trap target ATK/Level changes, Phantom Knights battle protection, and self monster summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${vambraceCode}.lua`));
    const databaseVambrace = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === vambraceCode);
    expect(databaseVambrace).toBeDefined();
    const reader = createCardReader([
      databaseVambrace!,
      { code: targetCode, name: "Lost Vambrace Phantom Knights Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPhantomKnights], race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    ]);
    const restoredOpen = createRestoredVambraceField({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const vambrace = requireCard(restoredOpen.session, vambraceCode);
    const target = requireCard(restoredOpen.session, targetCode);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === vambrace.uid && action.effectId === "lua-1-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    const summonedVambrace = restoredOpen.session.state.cards.find((card) => card.uid === vambrace.uid);
    expect(summonedVambrace).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: vambrace.uid,
      reasonEffectId: 1,
      data: {
        attack: 600,
        defense: 0,
        level: 2,
        race: raceWarrior,
        attribute: attributeDark,
      },
    });
    expect(cardTypeFlags(summonedVambrace, restoredOpen.session.state)).toBe(typeMonster | typeNormal);
    expect(currentAttack(summonedVambrace, restoredOpen.session.state)).toBe(600);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1200);
    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      (effect.sourceUid === target.uid && (effect.code === effectUpdateAttack || effect.code === effectChangeLevel)) ||
      (effect.sourceUid === vambrace.uid && effect.code === effectIndestructableBattle)
    ).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        registryKey: `lua:${vambraceCode}:lua-2-100`,
        reset: { flags: resetStandardPhaseEnd },
        sourceUid: target.uid,
        targetRange: undefined,
        value: -600,
      },
      {
        code: effectChangeLevel,
        registryKey: `lua:${vambraceCode}:lua-3-131`,
        reset: { flags: resetStandardPhaseEnd },
        sourceUid: target.uid,
        targetRange: undefined,
        value: 2,
      },
      {
        code: effectIndestructableBattle,
        registryKey: `lua:${vambraceCode}:lua-4-42`,
        reset: { flags: resetPhaseEnd },
        sourceUid: vambrace.uid,
        targetRange: [4, 0],
        value: 1,
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
      { eventCardUid: vambrace.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: vambrace.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "spellTrapZone", current: "monsterZone" },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === target.uid), restoredPersistent.session.state)).toBe(1200);
    expect(currentLevel(restoredPersistent.session.state.cards.find((card) => card.uid === target.uid), restoredPersistent.session.state)).toBe(2);
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredVambraceField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 36247316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [vambraceCode, targetCode] }, 1: { main: [] } });
  startDuel(session);
  const setVambrace = moveDuelCard(session.state, requireCard(session, vambraceCode).uid, "spellTrapZone", 0);
  setVambrace.faceUp = false;
  setVambrace.position = "faceDown";
  moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(vambraceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("The Phantom Knights of Lost Vambrace");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id,SET_THE_PHANTOM_KNIGHTS,TYPE_MONSTER|TYPE_NORMAL,600,0,2,RACE_WARRIOR,ATTRIBUTE_DARK)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetTarget(s.indtarget)");
  expect(script).toContain("c:AddMonsterAttribute(TYPE_NORMAL)");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,true,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("c:AddMonsterAttributeComplete()");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
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
