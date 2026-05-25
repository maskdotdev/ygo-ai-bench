import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { LuaPromptOverride } from "#lua/host-types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const armorCode = "11677278";
const faceupOpponentCode = "116772780";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasArmorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${armorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFlip = 0x200000;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const setMimighoul = 0x1b5;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const categorySet = 0x100000000;
const effectIndestructibleBattle = 42;
const locationMonsterZone = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasArmorScript)("Lua real script Mimighoul Armor battle protect control summon", () => {
  it("restores SelectEffect self-summon and FLIP Mimighoul battle protection before control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${armorCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const summonOpen = createRestoredSelfSummonWindow({ reader, workspace });
    const handArmor = requireCard(summonOpen.session, armorCode);
    expectCleanRestore(summonOpen);
    expect(summonOpen.session.state.effects.filter((effect) => effect.sourceUid === handArmor.uid).map((effect) => ({
      category: effect.category,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, countLimit: 1, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { category: categorySpecialSummon + categorySet, countLimit: 1, event: "ignition", range: ["hand"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(summonOpen, 0);
    const selfSummon = getLuaRestoreLegalActions(summonOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handArmor.uid && action.effectId === "lua-2"
    );
    expect(selfSummon, JSON.stringify(getLuaRestoreLegalActions(summonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summonOpen, selfSummon!);
    resolveRestoredChain(summonOpen);
    expect(summonOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      options: "options" in prompt ? prompt.options : [],
      returned: "returned" in prompt ? prompt.returned : undefined,
    }))).toEqual([{ api: "SelectEffect", player: 0, options: [1, 2], returned: 2 }]);
    expect(summonOpen.session.state.cards.find((card) => card.uid === handArmor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handArmor.uid,
      reasonEffectId: 2,
    });

    const flipOpen = createRestoredFlipWindow({ reader, workspace });
    const fieldArmor = requireCard(flipOpen.session, armorCode);
    expectCleanRestore(flipOpen);
    expectRestoredLegalActions(flipOpen, 0);
    const flip = getLuaRestoreLegalActions(flipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === fieldArmor.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(flipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(flipOpen, flip!);

    const triggerWindow = restoreDuelWithLuaScripts(serializeDuel(flipOpen.session), workspace, reader);
    expectCleanRestore(triggerWindow);
    expectRestoredLegalActions(triggerWindow, 0);
    const flipTrigger = getLuaRestoreLegalActions(triggerWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fieldArmor.uid && action.effectId === "lua-1"
    );
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(triggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(triggerWindow, flipTrigger!);

    resolveRestoredChain(triggerWindow);
    const protectWindow = restoreDuelWithLuaScripts(serializeDuel(triggerWindow.session), workspace, reader);
    expectCleanRestore(protectWindow);
    expectRestoredLegalActions(protectWindow, 0);

    expect(protectWindow.session.state.effects.find((effect) =>
      effect.code === effectIndestructibleBattle && effect.sourceUid === fieldArmor.uid
    )).toMatchObject({
      code: effectIndestructibleBattle,
      event: "continuous",
      targetRange: [locationMonsterZone, locationMonsterZone],
      value: 1,
      luaTargetDescriptor: `target:setcode:${setMimighoul}`,
    });
    expect(protectWindow.session.state.cards.find((card) => card.uid === fieldArmor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldArmor.uid,
      reasonEffectId: 1,
    });
    expect(protectWindow.session.state.eventHistory.filter((event) => ["flipSummoned", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "flipSummoned", eventCode: 1101, eventCardUid: fieldArmor.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: fieldArmor.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fieldArmor.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "monsterZone" },
    ]);
  });
});

function createRestoredSelfSummonWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 11677278, { 0: { main: [armorCode] }, 1: { main: [faceupOpponentCode] } });
  moveDuelCard(session.state, requireCard(session, armorCode).uid, "hand", 0);
  const opponentMonster = moveDuelCard(session.state, requireCard(session, faceupOpponentCode).uid, "monsterZone", 1);
  opponentMonster.faceUp = true;
  opponentMonster.position = "faceUpAttack";
  return registerAndRestore(session, workspace, reader, [{ api: "SelectEffect", player: 0, returned: 2 }]);
}

function createRestoredFlipWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 11677279, { 0: { main: [armorCode] }, 1: { main: [] } });
  const armor = moveDuelCard(session.state, requireCard(session, armorCode).uid, "monsterZone", 0);
  armor.faceUp = false;
  armor.position = "faceDownDefense";
  return registerAndRestore(session, workspace, reader, []);
}

function baseSession(reader: ReturnType<typeof createCardReader>, seed: number, decks: Parameters<typeof loadDecks>[1]): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, decks);
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAndRestore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>, promptOverrides: LuaPromptOverride[]): ReturnType<typeof restoreDuelWithLuaScripts> {
  const host = createLuaScriptHost(session, workspace, { promptOverrides });
  expect(host.loadCardScript(Number(armorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mimighoul Armor");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsMainPhase() end)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_MIMIGHOUL))");
  expect(script).toContain("e1:SetValue(1)");
  expect(script).toContain("aux.RegisterClientHint(c,0,tp,1,1,aux.Stringid(id,2))");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_SET)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,1-tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: armorCode, name: "Mimighoul Armor", kind: "monster", typeFlags: typeMonster | typeEffect | typeFlip, race: raceWarrior, attribute: attributeEarth, setcodes: [setMimighoul], level: 1, attack: 600, defense: 1500 },
    { code: faceupOpponentCode, name: "Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 1, attack: 500, defense: 500 },
  ];
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
  const waitingFor = restored.session.state.waitingFor;
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
