import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const wonkyCode = "47195442";
const topMonsterACode = "471954420";
const topMonsterBCode = "471954421";
const topMonsterCCode = "471954422";
const topSpellCode = "471954423";
const topTrapCode = "471954424";
const preMaterialACode = "471954425";
const preMaterialBCode = "471954426";
const preMaterialCCode = "471954427";
const extraMonsterCode = "471954428";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWonkyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wonkyCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const categoryDamage = 0x80000;
const categoryDestroy = 0x1;
const effectFlagSingleRange = 131072;
const effectFlagCannotDisableUncopyable = 263168;
const effectSummonProcedure = 31;
const effectImmuneEffect = 1;

describe.skipIf(!hasUpstreamScripts || !hasWonkyScript)("Lua real script Wonky Quartet decktop overlay branch", () => {
  it("restores Xyz summon and Standby deck-top overlay branches into control or burn-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wonkyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const controlOpen = createRestoredSpecialSummonTrigger({
      deckCodes: [topMonsterACode, topMonsterBCode, topMonsterCCode],
      preMaterialCodes: [],
      reader,
      workspace,
    });
    const controlWonky = requireCard(controlOpen.session, wonkyCode);
    expectCleanRestore(controlOpen);
    expectRestoredLegalActions(controlOpen, 0);
    expect(controlOpen.session.state.effects.filter((effect) => effect.sourceUid === controlWonky.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: effectSummonProcedure, countLimit: undefined, event: "continuous", property: effectFlagCannotDisableUncopyable, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: effectImmuneEffect, countLimit: undefined, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl | categoryDamage | categoryDestroy, code: 1102, countLimit: undefined, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryControl | categoryDamage | categoryDestroy, code: 4098, countLimit: 1, event: "trigger", property: undefined, range: ["monsterZone"], triggerEvent: "phaseStandby" },
    ]);
    expect(controlOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-3-1102",
        sourceUid: controlWonky.uid,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventPlayer: 0,
        eventCardUid: controlWonky.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const controlTrigger = restoreDuelWithLuaScripts(serializeDuel(controlOpen.session), workspace, reader);
    expectCleanRestore(controlTrigger);
    expectRestoredLegalActions(controlTrigger, 0);
    activateTrigger(controlTrigger, controlWonky.uid, "lua-3-1102");
    const controlOperationInfos = controlTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? []);
    expect(controlOperationInfos).toEqual([]);
    passRestoredChain(controlTrigger);
    expect(controlTrigger.session.state.cards.find((card) => card.uid === controlWonky.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      overlayUids: [
        requireCard(controlTrigger.session, topMonsterACode).uid,
        requireCard(controlTrigger.session, extraMonsterCode).uid,
        requireCard(controlTrigger.session, topMonsterCCode).uid,
      ],
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: controlWonky.uid,
      reasonEffectId: 3,
    });
    for (const code of [topMonsterACode, extraMonsterCode, topMonsterCCode]) {
      expect(controlTrigger.session.state.cards.find((card) => card.code === code)).toMatchObject({
        location: "overlay",
        controller: 0,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: controlWonky.uid,
        reasonEffectId: 3,
      });
    }
    expect(controlTrigger.session.state.shuffleCheckDisabled).toBe(true);
    expect(controlTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: controlWonky.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: controlWonky.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: controlWonky.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const damageOpen = createRestoredSpecialSummonTrigger({
      deckCodes: [topMonsterACode, topMonsterBCode, topMonsterCCode],
      preMaterialCodes: [preMaterialACode, preMaterialBCode, preMaterialCCode],
      reader,
      workspace,
    });
    const damageWonky = requireCard(damageOpen.session, wonkyCode);
    expectCleanRestore(damageOpen);
    expectRestoredLegalActions(damageOpen, 0);
    const damageTrigger = restoreDuelWithLuaScripts(serializeDuel(damageOpen.session), workspace, reader);
    expectCleanRestore(damageTrigger);
    expectRestoredLegalActions(damageTrigger, 0);
    activateTrigger(damageTrigger, damageWonky.uid, "lua-3-1102");
    const damageOperationInfos = damageTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? []);
    expect(damageOperationInfos).toEqual([]);
    passRestoredChain(damageTrigger);
    expect(damageTrigger.session.state.players[0].lifePoints).toBe(5600);
    expect(damageTrigger.session.state.cards.find((card) => card.uid === damageWonky.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: damageWonky.uid,
      reasonEffectId: 3,
    });
    expect(damageTrigger.session.state.eventHistory.filter((event) => ["damageDealt", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 2400,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageWonky.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: damageWonky.uid,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageWonky.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const standbyOpen = createRestoredStandbyOpen({
      deckCodes: [topMonsterACode, topMonsterBCode, topMonsterCCode],
      reader,
      workspace,
    });
    const standbyWonky = requireCard(standbyOpen.session, wonkyCode);
    expectCleanRestore(standbyOpen);
    expectRestoredLegalActions(standbyOpen, 0);
    const standby = getLuaRestoreLegalActions(standbyOpen, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(standbyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(standbyOpen, standby!);
    expect(standbyOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-4-4098",
        sourceUid: standbyWonky.uid,
        eventName: "phaseStandby",
        eventCode: 4098,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Wonky Quartet");
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,2,nil,nil,Xyz.InfiniteMats)");
  expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
  expect(script).toContain("return te:GetOwner()~=e:GetOwner()");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL+CATEGORY_DAMAGE+CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
  expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.GetDecktopGroup(tp,3)");
  expect(script).toContain("Duel.DisableShuffleCheck()");
  expect(script).toContain("Duel.Overlay(c,g)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("Duel.Damage(tp,#og*400,REASON_EFFECT)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: wonkyCode, name: "Wonky Quartet", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceBeast, attribute: attributeEarth, level: 4, attack: 0, defense: 2600 },
    { code: topMonsterACode, name: "Wonky Top Monster A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: topMonsterBCode, name: "Wonky Top Monster B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: topMonsterCCode, name: "Wonky Top Monster C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: topSpellCode, name: "Wonky Top Spell", kind: "spell", typeFlags: typeSpell },
    { code: topTrapCode, name: "Wonky Top Trap", kind: "trap", typeFlags: typeTrap },
    { code: preMaterialACode, name: "Wonky Previous Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: preMaterialBCode, name: "Wonky Previous Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: preMaterialCCode, name: "Wonky Previous Material C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: extraMonsterCode, name: "Wonky Extra Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredSpecialSummonTrigger({
  deckCodes,
  preMaterialCodes,
  reader,
  workspace,
}: {
  deckCodes: string[];
  preMaterialCodes: string[];
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 47195442, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [...deckCodes, ...preMaterialCodes, extraMonsterCode], extra: [wonkyCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(wonkyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const wonky = requireCard(session, wonkyCode);
  specialSummonDuelCard(session.state, wonky.uid, 0, 0, {}, luaSummonTypeXyz, true, true);
  for (const [sequence, code] of preMaterialCodes.entries()) {
    const material = requireCard(session, code);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = sequence;
    wonky.overlayUids.push(material.uid);
  }
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredStandbyOpen({
  deckCodes,
  reader,
  workspace,
}: {
  deckCodes: string[];
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 47195443, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: deckCodes, extra: [wonkyCode] }, 1: { main: [] } });
  startDuel(session);
  const wonky = requireCard(session, wonkyCode);
  moveFaceUpAttack(session, wonky, 0, 0);
  wonky.summonType = "xyz";
  wonky.summonTypeCode = luaSummonTypeXyz;
  session.state.turn = 2;
  session.state.phase = "draw";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(wonkyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function activateTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, effectId: string): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const trigger = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "activateTrigger" && action.uid === uid && action.effectId === effectId
  );
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, trigger!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
