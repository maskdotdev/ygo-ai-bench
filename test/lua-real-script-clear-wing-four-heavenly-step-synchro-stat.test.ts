import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const clearWingCode = "54603525";
const targetCode = "546035250";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasClearWingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clearWingCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const attributeWind = 0x8;
const attributeDark = 0x20;
const starterCode = "546035251";
const tunerCode = "546035252";
const synchroCode = "546035253";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasClearWingScript)("Lua real script Clear Wing Four Heavenly step Synchro stat", () => {
  it("restores delayed Special Summon trigger into opponent Effect Monster destroy and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${clearWingCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const clearWing = requireCard(session, clearWingCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.faceUp = true;
    target.position = "faceUpAttack";
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(clearWingCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === clearWing.uid && effect.triggerEvent === "chaining")).toMatchObject({
      event: "quick",
      luaConditionDescriptor: "condition:event-player:opponent",
    });
    specialSummonDuelCard(session.state, clearWing.uid, 0, 0, { eventReasonCardUid: clearWing.uid, eventReasonEffectId: 99 }, 0, true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === clearWing.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: clearWing.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === clearWing.uid), restoredResolved.session.state)).toBe(5500);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("keeps the opponent activation chain open for its Step summon and optional WIND Synchro response", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${clearWingCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const clearWing = requireCard(session, clearWingCode);
    const starter = requireCard(session, starterCode);
    const tuner = requireCard(session, tunerCode);
    const synchro = requireCard(session, synchroCode);
    moveFaceUpAttack(session, clearWing, 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    moveDuelCard(session.state, tuner.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(clearWingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starterAction!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.waitingFor).toBe(0);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const clearWingAction = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === clearWing.uid);
    expect(clearWingAction, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, clearWingAction!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.synchro,
      reasonPlayer: 0,
      reasonCardUid: clearWing.uid,
      reasonEffectId: 4,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === clearWing.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.synchro,
      reasonPlayer: 0,
      reasonCardUid: clearWing.uid,
      reasonEffectId: 4,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
    });
    expect(restoredResponse.host.messages).toContain("clear wing starter resolved");
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsEffectMonster),tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("c:UpdateAttack(atk)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_HAND|LOCATION_GRAVE,0,1,1,nil,e,tp):GetFirst()");
  expect(script).toContain("Duel.SpecialSummonStep(sc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("sc:NegateEffects(e:GetHandler())");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.SynchroSummon(tp,synchro)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === clearWingCode),
    { code: targetCode, name: "Four Heavenly Effect Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 8, attack: 3000, defense: 2500 },
    { code: starterCode, name: "Four Heavenly Starter Spell", kind: "spell", typeFlags: typeSpell },
    { code: tunerCode, name: "Four Heavenly WIND Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, attribute: attributeWind, level: 2, attack: 800, defense: 800 },
    { code: synchroCode, name: "Four Heavenly WIND Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, attribute: attributeWind, level: 9, attack: 3000, defense: 2500 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 54603525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clearWingCode, tunerCode], extra: [synchroCode] }, 1: { main: [targetCode, starterCode] } });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${starterCode}.lua`) return starterScript();
      return workspace.readScript(name);
    },
  };
  return { session, reader, source };
}

function starterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("clear wing starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
