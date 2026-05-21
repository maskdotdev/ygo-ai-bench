import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const starvingCode = "5148778";
const summonStarterCode = "51487780";
const chainStarterCode = "51487781";
const summonedCode = "51487782";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasStarvingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${starvingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasStarvingScript)("Lua real script Starving Venom Wing summon chain PZone", () => {
  it("restores opponent Special Summon targeting, ATK gain/negate, chain destruction, and destroyed PZone placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${starvingCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c,false)");
    expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsType,TYPE_FUSION),aux.FilterBoolFunctionEx(Card.IsSetCard,SET_CLEAR_WING))");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("Duel.SetTargetCard(tc)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("c:UpdateAttack(tc:GetAttack(),RESETS_STANDARD_DISABLE_PHASE_END)");
    expect(script).toContain("tc:NegateEffects(c,RESETS_STANDARD_PHASE_END)");
    expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)&LOCATION_ONFIELD>0");
    expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
    expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.CheckPendulumZones(tp)");
    expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === starvingCode),
      { code: summonStarterCode, name: "Starving Venom Wing Summon Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: chainStarterCode, name: "Starving Venom Wing Field Chain Starter", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: summonedCode, name: "Starving Venom Wing Opponent Summoned Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5148778, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [starvingCode] }, 1: { main: [summonStarterCode, chainStarterCode, summonedCode] } });
    startDuel(session);

    const starving = requireCard(session, starvingCode);
    const summonStarter = requireCard(session, summonStarterCode);
    const chainStarter = requireCard(session, chainStarterCode);
    const summoned = requireCard(session, summonedCode);
    moveFaceUpAttack(session, starving, 0);
    starving.summonType = "fusion";
    starving.summonPlayer = 0;
    moveFaceUpAttack(session, summonStarter, 1);
    moveDuelCard(session.state, chainStarter.uid, "spellTrapZone", 1).faceUp = true;
    moveDuelCard(session.state, summoned.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${summonStarterCode}.lua`) return summonStarterScript(summonedCode);
        if (name === `c${chainStarterCode}.lua`) return fieldChainStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [starvingCode, summonStarterCode, chainStarterCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, 1);
    const summonAgain = getLuaRestoreLegalActions(restoredSummonChain, 1).find((action) => action.type === "activateEffect" && action.uid === summonStarter.uid);
    expect(summonAgain, JSON.stringify(getLuaRestoreLegalActions(restoredSummonChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonChain, summonAgain!);
    passRestoredChain(restoredSummonChain);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonChain.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === summoned.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 1,
      reasonCardUid: summonStarter.uid,
      reasonEffectId: 7,
    });
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === starving.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === starving.uid), restoredTrigger.session.state)).toBe((starving.data.attack ?? 0) + 1800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === summoned.uid && [2, 3].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, sourceUid: summoned.uid, reset: { count: 1, flags: 1107169792 }, value: undefined },
    ]);

    restoredTrigger.session.state.turnPlayer = 1;
    restoredTrigger.session.state.waitingFor = 1;
    const restoredFieldChainOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredFieldChainOpen);
    expectRestoredLegalActions(restoredFieldChainOpen, 1);
    const fieldActivation = getLuaRestoreLegalActions(restoredFieldChainOpen, 1).find((action) => action.type === "activateEffect" && action.uid === chainStarter.uid);
    expect(fieldActivation, JSON.stringify(getLuaRestoreLegalActions(restoredFieldChainOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFieldChainOpen, fieldActivation!);

    const restoredChainResponse = restoreDuelWithLuaScripts(serializeDuel(restoredFieldChainOpen.session), source, reader);
    expectCleanRestore(restoredChainResponse);
    expectRestoredLegalActions(restoredChainResponse, 0);
    const destroyResponse = getLuaRestoreLegalActions(restoredChainResponse, 0).find((action) => action.type === "activateEffect" && action.uid === starving.uid);
    expect(destroyResponse, JSON.stringify(getLuaRestoreLegalActions(restoredChainResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChainResponse, destroyResponse!);
    passRestoredChain(restoredChainResponse);

    const destroyedStarving = restoredChainResponse.session.state.cards.find((card) => card.uid === starving.uid);
    expect(destroyedStarving).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: starving.uid,
      reasonEffectId: 5,
    });
    expect(restoredChainResponse.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === starving.uid)).toHaveLength(1);

    const restoredPzoneTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredChainResponse.session), source, reader);
    expectCleanRestore(restoredPzoneTrigger);
    expectRestoredLegalActions(restoredPzoneTrigger, 0);
    const pzone = getLuaRestoreLegalActions(restoredPzoneTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === starving.uid);
    expect(pzone, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzoneTrigger, pzone!);
    passRestoredChain(restoredPzoneTrigger);
    expect(restoredPzoneTrigger.session.state.cards.find((card) => card.uid === starving.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: starving.uid,
      reasonEffectId: 6,
    });
    expect(restoredPzoneTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function summonStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(function(c) return c:IsCode(${targetCode}) and c:IsCanBeSpecialSummoned(e,0,tp,false,false) end,tp,LOCATION_HAND,0,1,nil) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,function(c) return c:IsCode(${targetCode}) end,tp,LOCATION_HAND,0,1,1,nil)
        if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function fieldChainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_SZONE)
      e:SetOperation(function(e,tp) Debug.Message("starving field starter resolved") end)
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
