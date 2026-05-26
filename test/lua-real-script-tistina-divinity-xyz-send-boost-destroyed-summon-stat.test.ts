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
const divinityCode = "87676171";
const crystalGodCode = "86999951";
const materialCode = "876761710";
const reviveCode = "876761711";
const setCardCode = "876761712";
const destroySpellCode = "876761713";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDivinityScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${divinityCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceAqua = 0x40;
const attributeLight = 0x10;
const setTistina = 0x208;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDivinityScript)("Lua real script Tistina Divinity Xyz send boost destroyed summon stat", () => {
  it("restores Xyz summon face-down send, Crystal God material ATK gain, and destroyed material revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${divinityCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,10,2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.AND(Card.IsFacedown,Card.IsAbleToGrave),tp,0,LOCATION_ONFIELD,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e:GetHandler():GetOverlayGroup():IsExists(Card.IsCode,1,nil,CARD_CRYSTAL_GOD_TISTINA)");
    expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(2000)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END,2)");
    expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("e:GetLabel()>0 and c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e4:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("e:GetLabelObject():SetLabel(e:GetHandler():GetOverlayCount())");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 87676171, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [crystalGodCode, materialCode, reviveCode], extra: [divinityCode] },
      1: { main: [setCardCode, destroySpellCode] },
    });
    startDuel(session);

    const divinity = requireCard(session, divinityCode);
    const crystalGod = requireCard(session, crystalGodCode);
    const material = requireCard(session, materialCode);
    const reviveTistina = requireCard(session, reviveCode);
    const opponentSet = requireCard(session, setCardCode);
    const destroySpell = requireCard(session, destroySpellCode);
    moveFaceUpAttack(session, crystalGod, 0, 0);
    moveFaceUpAttack(session, material, 0, 1);
    moveDuelCard(session.state, reviveTistina.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentSet.uid, "spellTrapZone", 1);
    opponentSet.faceUp = false;
    opponentSet.position = "faceDown";
    moveDuelCard(session.state, destroySpell.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = sourceWithLocalScripts(workspace);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(divinityCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroySpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const xyzSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "xyzSummon"
      && action.uid === divinity.uid
      && action.materialUids.includes(crystalGod.uid)
      && action.materialUids.includes(material.uid)
    );
    expect(xyzSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, xyzSummon!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === divinity.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "xyz",
      summonMaterialUids: [crystalGod.uid, material.uid],
      overlayUids: [crystalGod.uid, material.uid],
    });

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    expect(restoredSummonTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1102", eventCardUid: divinity.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: divinity.uid, triggerBucket: "turnOptional" },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === divinity.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, summonTrigger!);
    expect(restoredSummonTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredSummonTrigger);
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === opponentSet.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: divinity.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: divinity.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentSet.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: divinity.uid, eventReasonEffectId: 2, previous: "spellTrapZone", current: "graveyard" },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === divinity.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === crystalGod.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: divinity.uid,
      reasonEffectId: 3,
    });
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === divinity.uid)?.overlayUids).toEqual([material.uid]);
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === divinity.uid), restoredIgnition.session.state)).toBe(4000);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === divinity.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792, count: 2 }, sourceUid: divinity.uid, value: 2000 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial")).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: crystalGod.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: divinity.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredDestroyOpen = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), source, reader);
    expectCleanRestore(restoredDestroyOpen);
    restoredDestroyOpen.session.state.phase = "main1";
    restoredDestroyOpen.session.state.turnPlayer = 1;
    restoredDestroyOpen.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredDestroyOpen, 1);
    const destroy = getLuaRestoreLegalActions(restoredDestroyOpen, 1).find((action) => action.type === "activateEffect" && action.uid === destroySpell.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyOpen, destroy!);
    resolveRestoredChain(restoredDestroyOpen);
    expect(restoredDestroyOpen.session.state.cards.find((card) => card.uid === divinity.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroySpell.uid,
      reasonEffectId: 6,
    });

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyOpen.session), source, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1029", eventCardUid: divinity.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: divinity.uid, triggerBucket: "opponentOptional" },
    ]);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === divinity.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyedTrigger!);
    expect(restoredDestroyed.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroyed);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === reviveTistina.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: divinity.uid,
      reasonEffectId: 4,
    });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: divinity.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: divinity.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: destroySpell.uid, eventReasonEffectId: 6, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveTistina.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: divinity.uid, eventReasonEffectId: 4, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => [divinityCode, crystalGodCode].includes(card.code)),
    { code: materialCode, name: "Tistina Divinity Level 10 Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeLight, setcodes: [setTistina], level: 10, attack: 1000, defense: 3000 },
    { code: reviveCode, name: "Tistina Divinity Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeLight, setcodes: [setTistina], level: 4, attack: 1200, defense: 1200 },
    { code: setCardCode, name: "Tistina Opponent Face-down Card", kind: "spell", typeFlags: typeSpell },
    { code: destroySpellCode, name: "Tistina Opponent Destroy Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function sourceWithLocalScripts(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${destroySpellCode}.lua`) return destroySpellScript();
      return workspace.readScript(name);
    },
  };
}

function destroySpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.tg)
      e:SetOperation(s.op)
      c:RegisterEffect(e)
    end
    function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil) end
      local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
    end
    function s.op(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)
      if #g>0 then Duel.Destroy(g,REASON_EFFECT) end
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
