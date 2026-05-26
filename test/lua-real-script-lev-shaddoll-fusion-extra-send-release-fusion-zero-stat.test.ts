import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeFusion } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const levCode = "34950192";
const sentFusionCode = "349501920";
const releaseFusionCode = "349501921";
const shaddollFusionCode = "349501922";
const fusionMaterialCode = "349501923";
const responderCode = "349501924";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLevScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${levCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const setShaddoll = 0x9d;
const categoryToGrave = 0x20;
const categorySpecialSummon = 0x200;
const locationExtraDeck = 0x40;
const effectCannotSpecialSummon = 22;
const effectSetAttackFinal = 102;
const duelActivitySpecialSummon = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLevScript)("Lua real script Lev Shaddoll Fusion Extra send release Fusion zero stat", () => {
  it("restores activation Extra Deck send, Shaddoll oath, release-cost Attribute label, and Fusion Summon ATK zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${levCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetCost(s.effcost)");
    expect(script).toContain("Duel.GetCustomActivityCount(id,tp,ACTIVITY_SPSUMMON)==0");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("return c:IsLocation(LOCATION_EXTRA) and not c:IsSetCard(SET_SHADDOLL)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_EXTRA)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_EXTRA,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
    expect(script).toContain("e2:SetCost(Cost.AND(s.spcost,s.effcost))");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.spcostfilter,1,false,nil,nil,e,tp)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.spcostfilter,1,1,false,nil,nil,e,tp):GetFirst()");
    expect(script).toContain("e:SetLabel(sc:GetAttribute())");
    expect(script).toContain("Duel.Release(sc,REASON_COST)");
    expect(script).toContain("Duel.SetTargetParam(e:GetLabel())");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.SpecialSummonStep(sc,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(script).toContain("sc:CompleteProcedure()");
    expect(script).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_SPSUMMON,function(c) return not c:IsSummonLocation(LOCATION_EXTRA) or c:IsSetCard(SET_SHADDOLL) end)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 34950192, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [levCode, fusionMaterialCode], extra: [sentFusionCode, shaddollFusionCode, releaseFusionCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const lev = requireCard(session, levCode);
    const sentFusion = requireCard(session, sentFusionCode);
    const releaseFusion = requireCard(session, releaseFusionCode);
    const shaddollFusion = requireCard(session, shaddollFusionCode);
    const fusionMaterial = requireCard(session, fusionMaterialCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, lev.uid, "hand", 0);
    moveDuelCard(session.state, releaseFusion.uid, "monsterZone", 0);
    releaseFusion.faceUp = true;
    releaseFusion.position = "faceUpAttack";
    moveDuelCard(session.state, fusionMaterial.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = sourceWithResponder(workspace);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(levCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lev.uid && action.effectId === "lua-1-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: lev.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: categoryToGrave, targetUids: [], count: 1, player: 0, parameter: locationExtraDeck }],
      },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectCannotSpecialSummon)).toEqual([
      expect.objectContaining({
        code: effectCannotSpecialSummon,
        event: "continuous",
        luaTargetDescriptor: `special-summon-limit:not-setcode-extra:${setShaddoll}`,
        sourceUid: lev.uid,
        targetRange: [1, 0],
      }),
    ]);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.host.messages).not.toContain("lev shaddoll responder resolved");

    expect(restoredOpen.session.state.cards.find((card) => card.uid === lev.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === sentFusion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: lev.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === sentFusion.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: sentFusion.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lev.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === lev.uid && action.effectId === "lua-2");
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === releaseFusion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonCardUid: lev.uid,
      reasonEffectId: 2,
    });
    expect(restoredIgnition.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-2",
        effectLabel: attributeDark,
        sourceUid: lev.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [{ category: categorySpecialSummon, targetUids: [], count: 1, player: 0, parameter: locationExtraDeck }],
        targetParam: attributeDark,
      },
    ]);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.code === effectCannotSpecialSummon)).toHaveLength(2);
    resolveRestoredChain(restoredIgnition);

    expect(restoredIgnition.session.state.cards.find((card) => card.uid === shaddollFusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonTypeCode: luaSummonTypeFusion,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: lev.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === shaddollFusion.uid), restoredIgnition.session.state)).toBe(0);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === shaddollFusion.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 33427456 }, sourceUid: shaddollFusion.uid, value: 0 },
    ]);
    expect(restoredIgnition.session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([
      { player: 0, activity: duelActivitySpecialSummon, cardUid: shaddollFusion.uid },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: releaseFusion.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: lev.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: shaddollFusion.uid,
        eventUids: [shaddollFusion.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: lev.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredIgnition.host.messages).not.toContain("lev shaddoll responder resolved");
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === levCode),
    { code: sentFusionCode, name: "Lev Shaddoll Sent Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeDark, level: 6, attack: 2100, defense: 1000 },
    { code: releaseFusionCode, name: "Lev Shaddoll Release Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeDark, level: 6, attack: 2000, defense: 1000 },
    { code: shaddollFusionCode, name: "Lev Shaddoll Light Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2500, defense: 2000, setcodes: [setShaddoll], fusionMaterialMin: 1, fusionMaterialType: typeMonster },
    { code: fusionMaterialCode, name: "Lev Shaddoll Fusion Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: responderCode, name: "Lev Shaddoll Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function sourceWithResponder(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("lev shaddoll responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
