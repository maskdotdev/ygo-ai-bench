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
const greedyCode = "51570882";
const targetCode = "515708820";
const destroyerCode = "515708821";
const darkLevel8Code = "515708822";
const fieldMonsterCode = "515708823";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGreedyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${greedyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeSpell = 0x2;
const attributeDark = 0x20;
const attributeLight = 0x10;
const setPredaplant = 0x10f3;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGreedyScript)("Lua real script Greedy Venom Fusion Dragon disable revive", () => {
  it("restores targeted ATK-final zero and effect disable effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${greedyCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace, [greedyCode, targetCode], []);
    const greedy = requireCard(session, greedyCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, greedy, 0);
    greedy.summonType = "fusion";
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(greedyCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const disable = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === greedy.uid);
    expect(disable, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, disable!);
    resolveRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    const restoredGreedy = restoredResolved.session.state.cards.find((card) => card.uid === greedy.uid);
    expect(currentAttack(restoredGreedy, restoredResolved.session.state)).toBe(0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(2400);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === greedy.uid && [2, 8, 102].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, property: 1024, reset: { flags: 1107169792 }, value: 0 },
      { code: 2, property: 1024, reset: { flags: 1107169792 }, value: undefined },
      { code: 8, property: 1024, reset: { flags: 1107169792 }, value: undefined },
    ]);
    expect(restoredResolved.session.state.chain).toEqual([]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores destroyed-to-grave trigger into field destruction, optional DARK banish, and self summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const { session, reader, source } = createSession(workspace, [greedyCode, darkLevel8Code, fieldMonsterCode], [destroyerCode]);
    const greedy = requireCard(session, greedyCode);
    const darkLevel8 = requireCard(session, darkLevel8Code);
    const fieldMonster = requireCard(session, fieldMonsterCode);
    const destroyer = requireCard(session, destroyerCode);
    moveFaceUpAttack(session, greedy, 0);
    greedy.summonType = "fusion";
    greedy.customStatusMask = 0x8;
    moveFaceUpAttack(session, darkLevel8, 0);
    moveFaceUpAttack(session, fieldMonster, 1);
    moveDuelCard(session.state, destroyer.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [greedyCode, destroyerCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 1);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroy!);
    resolveRestoredChain(restoredDestroy);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroy.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === greedy.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === darkLevel8.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: greedy.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === greedy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: greedy.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === fieldMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: greedy.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 825134114, returned: true },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "destroyed", eventCardUid: greedy.uid, eventReasonPlayer: 1, eventReasonCardUid: destroyer.uid, eventReasonEffectId: 5, eventUids: undefined },
      { eventName: "destroyed", eventCardUid: darkLevel8.uid, eventReasonPlayer: 0, eventReasonCardUid: greedy.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "destroyed", eventCardUid: fieldMonster.uid, eventReasonPlayer: 0, eventReasonCardUid: greedy.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "destroyed", eventCardUid: darkLevel8.uid, eventReasonPlayer: 0, eventReasonCardUid: greedy.uid, eventReasonEffectId: 4, eventUids: [darkLevel8.uid, fieldMonster.uid] },
      { eventName: "banished", eventCardUid: darkLevel8.uid, eventReasonPlayer: 0, eventReasonCardUid: greedy.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "specialSummoned", eventCardUid: greedy.uid, eventReasonPlayer: 0, eventReasonCardUid: greedy.uid, eventReasonEffectId: 4, eventUids: [greedy.uid] },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_PREDAPLANT),s.ffilter2)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsReason(REASON_DESTROY)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_REMOVE,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Remove(rg,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>, main0: string[], main1: string[]) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === greedyCode),
    { code: targetCode, name: "Greedy Venom Disable Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, level: 4, attack: 2400, defense: 1000 },
    { code: destroyerCode, name: "Greedy Venom Destroyer", kind: "spell", typeFlags: typeSpell },
    { code: darkLevel8Code, name: "Greedy Venom DARK Level 8", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 8, attack: 2600, defense: 2100 },
    { code: fieldMonsterCode, name: "Greedy Venom Field Monster", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 51570882, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0 }, 1: { main: main1 } });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript(greedyCode);
      return workspace.readScript(name);
    },
  };
  return { session, reader, source };
}

function destroyerScript(code: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${code}) end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
        local g=Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${code})
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then Duel.Destroy(tc,REASON_EFFECT) end
      end)
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
