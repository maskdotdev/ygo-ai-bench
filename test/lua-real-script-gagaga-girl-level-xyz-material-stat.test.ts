import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, xyzSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const girlCode = "3606728";
const magicianCode = "26082117";
const normalXyzCode = "36067280";
const opponentSpecialCode = "36067281";
const gagagaPartnerCode = "36067282";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGirlScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${girlCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const setGagaga = 0x54;
const effectSetAttackFinal = 102;
const effectAddType = 115;
const effectChangeLevel = 131;
const eventBeMaterial = 1108;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasGirlScript)("Lua real script Gagaga Girl Level Xyz material stat", () => {
  it("restores Level copy and Gagaga-only Xyz material grant into target ATK 0", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${girlCode}.lua`));
    const reader = createCardReader(cards());

    const restoredLevel = createRestoredLevelWindow({ reader, workspace });
    expectCleanRestore(restoredLevel);
    expectRestoredLegalActions(restoredLevel, 0);
    const levelGirl = requireCard(restoredLevel.session, girlCode);
    const magician = requireCard(restoredLevel.session, magicianCode);
    const levelAction = getLuaRestoreLegalActions(restoredLevel, 0).find((action) => action.type === "activateEffect" && action.uid === levelGirl.uid);
    expect(levelAction, JSON.stringify(getLuaRestoreLegalActions(restoredLevel, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLevel, levelAction!);
    passRestoredChain(restoredLevel);
    expect(currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === levelGirl.uid), restoredLevel.session.state)).toBe(4);
    expect(restoredLevel.session.state.effects.filter((effect) => effect.sourceUid === levelGirl.uid && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: levelGirl.uid, value: 4 },
    ]);
    expect(restoredLevel.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: magician.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredOpen = createRestoredXyzWindow({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const materialGirl = requireCard(restoredOpen.session, girlCode);
    const materialPartner = requireCard(restoredOpen.session, gagagaPartnerCode);
    const normalXyz = requireCard(restoredOpen.session, normalXyzCode);
    const opponentSpecial = requireCard(restoredOpen.session, opponentSpecialCode);
    xyzSummonDuelCard(restoredOpen.session.state, 0, normalXyz.uid, [materialGirl.uid, materialPartner.uid]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === normalXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "xyz",
      summonMaterialUids: [materialGirl.uid, materialPartner.uid],
      overlayUids: [materialGirl.uid, materialPartner.uid],
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === materialGirl.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.material | duelReason.xyz,
      reasonPlayer: 0,
      reasonCardUid: normalXyz.uid,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) =>
      (event.eventName === "usedAsMaterial" && event.eventCardUid === materialGirl.uid) ||
      (event.eventName === "specialSummoned" && event.eventCardUid === normalXyz.uid),
    )).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventReason: duelReason.xyz,
        eventReasonPlayer: 0,
        eventReasonCardUid: normalXyz.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "overlay", position: "faceUpAttack", sequence: 0 },
        eventCardUid: materialGirl.uid,
      },
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: normalXyz.uid,
      },
    ]);
    expect(cardTypeFlags(normalXyz, restoredOpen.session.state) & typeEffect).toBe(typeEffect);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === normalXyz.uid && [eventSpecialSummonSuccess, effectAddType].includes(effect.code ?? -1)).map((effect) => ({
      category: effect.category,
      code: effect.code,
      description: effect.description,
      event: effect.event,
      optional: effect.optional,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      {
        category: 0x200000,
        code: eventSpecialSummonSuccess,
        description: Number(girlCode) * 16 + 1,
        event: "trigger",
        optional: true,
        property: 0x10,
        reset: { flags: 33427456 },
        sourceUid: normalXyz.uid,
        triggerEvent: "specialSummoned",
        value: undefined,
      },
      {
        category: undefined,
        code: effectAddType,
        description: undefined,
        event: "continuous",
        optional: undefined,
        property: undefined,
        reset: { flags: 33427456 },
        sourceUid: normalXyz.uid,
        triggerEvent: undefined,
        value: typeEffect,
      },
    ]);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        player: 0,
        sourceUid: normalXyz.uid,
        effectId: "lua-3-1102",
        eventName: "specialSummoned",
        eventPlayer: 0,
        triggerBucket: "turnOptional",
        eventCode: eventSpecialSummonSuccess,
        eventTriggerTiming: "when",
        eventCardUid: normalXyz.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === normalXyz.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    passRestoredChain(restoredTriggerWindow);
    expect(currentAttack(restoredTriggerWindow.session.state.cards.find((card) => card.uid === opponentSpecial.uid), restoredTriggerWindow.session.state)).toBe(0);
    expect(restoredTriggerWindow.session.state.effects.filter((effect) => effect.sourceUid === opponentSpecial.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentSpecial.uid, value: 0 },
    ]);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: opponentSpecial.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    restoredTriggerWindow.session.state.phase = "battle";
    restoredTriggerWindow.session.state.turnPlayer = 0;
    restoredTriggerWindow.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const attack = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "declareAttack" && action.attackerUid === normalXyz.uid && action.targetUid === opponentSpecial.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, attack!);
    passRestoredBattle(restoredTriggerWindow);
    expect(restoredTriggerWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 2400 });
  });
});

function createRestoredLevelWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 3606728, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [girlCode, magicianCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, girlCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, magicianCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(girlCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredXyzWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 3606729, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [girlCode, gagagaPartnerCode], extra: [normalXyzCode] }, 1: { main: [opponentSpecialCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, girlCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, gagagaPartnerCode), 0, 1);
  const opponent = requireCard(session, opponentSpecialCode);
  moveFaceUpAttack(session, opponent, 1, 0);
  opponent.summonType = "special";
  opponent.summonPlayer = 1;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(girlCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_LVCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,0,1,1,nil,e:GetHandler():GetLevel())");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e1:SetValue(tc:GetLevel())");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return not ec:GetMaterial():IsExists(s.ffilter,1,nil) and r==REASON_XYZ");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetCode(EFFECT_ADD_TYPE)");
}

function cards(): DuelCardData[] {
  return [
    { code: girlCode, name: "Gagaga Girl", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 3, attack: 1000, defense: 800, setcodes: [setGagaga] },
    { code: magicianCode, name: "Gagaga Magician", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000, setcodes: [setGagaga] },
    { code: gagagaPartnerCode, name: "Gagaga Girl Xyz Partner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 3, attack: 1200, defense: 1000, setcodes: [setGagaga] },
    { code: normalXyzCode, name: "Gagaga Girl Normal Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceSpellcaster, attribute: attributeDark, level: 3, attack: 2400, defense: 2000, xyzMaterialCount: 2 },
    { code: opponentSpecialCode, name: "Gagaga Girl Opponent Special Summoned Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 2200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
