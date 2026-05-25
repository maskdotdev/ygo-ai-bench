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

const upstreamRoot = path.resolve(".upstream/ignis");
const recoilCode = "17000165";
const tokenCode = "21179144";
const zeroDestroyCode = "170001650";
const graveReptileCode = "170001651";
const chainTargetCode = "170001652";
const chainStarterCode = "170001653";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRecoilScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${recoilCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;
const typesToken = 0x4011;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setReptilianne = 0x3c;
const categoryDestroy = 0x1;
const categorySpecialSummon = 0x200;
const categoryToken = 0x400;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const effectFlagDelay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasRecoilScript)("Lua real script Reptilianne Recoil destroy summon chain token", () => {
  it("restores field destroy-summon and opponent monster-chain control plus token summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${recoilCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());

    const summon = createRestoredSummonField({ reader, source, workspace });
    expect(summon.restored.session.state.effects.filter((effect) => effect.sourceUid === summon.recoil.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 1002, countLimit: undefined, event: "ignition", property: undefined, range: ["hand", "spellTrapZone"], sourceUid: summon.recoil.uid, triggerEvent: undefined },
      { category: categoryDestroy | categorySpecialSummon, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["spellTrapZone"], sourceUid: summon.recoil.uid, triggerEvent: undefined },
      { category: categoryControl | categorySpecialSummon | categoryToken, code: 1027, countLimit: 1, event: "trigger", property: effectFlagDelay | effectFlagCardTarget, range: ["spellTrapZone"], sourceUid: summon.recoil.uid, triggerEvent: "chaining" },
    ]);
    const ignition = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summon.recoil.uid && action.effectId === "lua-2"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, ignition!);
    passRestoredChain(summon.restored);

    expect(findCard(summon.restored.session, summon.zeroDestroy.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: summon.recoil.uid,
      reasonEffectId: 2,
    });
    expect(findCard(summon.restored.session, summon.graveReptile.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summon.recoil.uid,
      reasonEffectId: 2,
    });
    expect(summon.restored.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: summon.zeroDestroy.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: summon.graveReptile.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previousLocation: "deck", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: summon.zeroDestroy.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: summon.recoil.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summon.graveReptile.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summon.recoil.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previousLocation: "graveyard", currentLocation: "monsterZone" },
    ]);

    const chain = createRestoredChainField({ reader, source, workspace });
    const starter = getLuaRestoreLegalActions(chain.restored, 1).find((action) =>
      action.type === "activateEffect" && action.uid === chain.chainStarter.uid
    );
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(chain.restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(chain.restored, starter!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(chain.restored.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === chain.recoil.uid && action.effectId === "lua-3-1027"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChainOrDecline(restoredTrigger);

    expect(findCard(restoredTrigger.session, chain.chainTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chain.recoil.uid,
      reasonEffectId: 3,
    });
    const tokens = restoredTrigger.session.state.cards.filter((card) => card.code === tokenCode);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      location: "monsterZone",
      controller: 1,
      owner: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: chain.recoil.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["chaining", "becameTarget", "controlChanged", "breakEffect", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "chaining", eventCode: 1027, eventCardUid: chain.chainStarter.uid, eventPlayer: 1, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previousLocation: "deck", previousController: 1, currentLocation: "hand", currentController: 1 },
      { eventName: "chaining", eventCode: 1027, eventCardUid: chain.recoil.uid, eventPlayer: 0, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previousLocation: "deck", previousController: 0, currentLocation: "spellTrapZone", currentController: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: chain.chainTarget.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previousLocation: "deck", previousController: 1, currentLocation: "monsterZone", currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: chain.chainTarget.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: chain.recoil.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: chain.recoil.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: undefined, previousController: undefined, currentLocation: undefined, currentController: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: tokens[0]!.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: chain.recoil.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "hand", previousController: 0, currentLocation: "monsterZone", currentController: 1 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Reptilianne Recoil");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.GetMZoneCount(tp,c)>0");
  expect(script).toContain("Duel.SelectTarget(tp,s.desfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.Destroy(tc1,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SpecialSummon(tc2,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return rp==1-tp and re:IsMonsterEffect()");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,TOKEN_REPTILIANNE,0,TYPES_TOKEN,0,0,1,RACE_REPTILE,ATTRIBUTE_EARTH,POS_FACEUP,1-tp)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("local token=Duel.CreateToken(tp,TOKEN_REPTILIANNE)");
  expect(script).toContain("Duel.SpecialSummon(token,0,tp,1-tp,false,false,POS_FACEUP)");
}

type ScriptSource = { readScript(name: string): string | undefined };

function createRestoredSummonField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 17000165, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [recoilCode, zeroDestroyCode, graveReptileCode] }, 1: { main: [] } });
  startDuel(session);
  const recoil = requireCard(session, recoilCode);
  const zeroDestroy = requireCard(session, zeroDestroyCode);
  const graveReptile = requireCard(session, graveReptileCode);
  moveFaceUpFieldSpell(session, recoil, 0);
  moveFaceUpAttack(session, zeroDestroy, 0, 0);
  moveDuelCard(session.state, graveReptile.uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, source, workspace, reader, 1);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, recoil, zeroDestroy, graveReptile };
}

function createRestoredChainField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 17000166, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [recoilCode] }, 1: { main: [chainTargetCode, chainStarterCode] } });
  startDuel(session);
  const recoil = requireCard(session, recoilCode);
  const chainTarget = requireCard(session, chainTargetCode);
  const chainStarter = requireCard(session, chainStarterCode);
  moveFaceUpFieldSpell(session, recoil, 0);
  moveFaceUpAttack(session, chainTarget, 1, 0);
  moveDuelCard(session.state, chainStarter.uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const restored = registerAndRestore(session, source, workspace, reader, 2);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 1);
  return { restored, recoil, chainTarget, chainStarter };
}

function registerAndRestore(session: DuelSession, source: ScriptSource, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>, expectedRegistered: number) {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(recoilCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(expectedRegistered);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("reptilianne chain starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: recoilCode, name: "Reptilianne Recoil", kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setReptilianne] },
    { code: tokenCode, name: "Reptilianne Token", kind: "monster", typeFlags: typesToken, race: raceReptile, attribute: attributeEarth, level: 1, attack: 0, defense: 0, setcodes: [setReptilianne] },
    { code: zeroDestroyCode, name: "Reptilianne Recoil Zero Destroy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 0, defense: 1000 },
    { code: graveReptileCode, name: "Reptilianne Recoil Grave Reptile", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: chainTargetCode, name: "Reptilianne Recoil Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 0, defense: 1000 },
    { code: chainStarterCode, name: "Reptilianne Recoil Chain Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
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

function moveFaceUpFieldSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = 0;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredChainOrDecline(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const actions = getLuaRestoreLegalActions(restored, player);
    const action = actions.find((candidate) => candidate.type === "passChain") ?? actions.find((candidate) => candidate.type === "declineTrigger");
    expect(action, JSON.stringify(actions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
