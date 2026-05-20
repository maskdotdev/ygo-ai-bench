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
const gumCode = "70939418";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gumCode}.lua`));
const windNonTunerCode = "709394181";
const synchroCode = "709394182";
const millSpeedroidCode = "709394183";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const attributeWind = 0x8;
const setSpeedroid = 0x2016;

describe.skipIf(!hasUpstreamScripts || !hasGumScript)("Lua real script Speedroid Gum Prize damage Synchro mill stat", () => {
  it("restores damage-trigger self summon, flag-gated Lua Synchro Summon, and material mill ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gumCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_DAMAGE)");
    expect(script).toContain("return Duel.IsBattlePhase()");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD&~(RESET_TEMP_REMOVE|RESET_TURN_SET)|RESET_PHASE|PHASE_BATTLE,0,1)");
    expect(script).toContain("return e:GetHandler():GetFlagEffect(id)~=0");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsSynchroSummonable,tp,LOCATION_EXTRA,0,1,nil,c,mg)");
    expect(script).toContain("Duel.SynchroSummon(tp,sg:GetFirst(),c,mg)");
    expect(script).toContain("e3:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("Duel.DiscardDeck(tp,1,REASON_EFFECT)");
    expect(script).toContain("local tc=Duel.GetOperatedGroup():GetFirst()");
    expect(script).toContain("sync:RegisterEffect(e1)");

    const cards: DuelCardData[] = [
      { code: gumCode, name: "Speedroid Gum Prize", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, attribute: attributeWind, setcodes: [setSpeedroid], level: 1, attack: 0, defense: 800 },
      { code: windNonTunerCode, name: "Gum Prize WIND Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, level: 3, attack: 1200, defense: 1000 },
      { code: synchroCode, name: "Gum Prize Synchro Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, attribute: attributeWind, level: 4, attack: 2200, defense: 1600 },
      { code: millSpeedroidCode, name: "Gum Prize Milled Speedroid", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, setcodes: [setSpeedroid], level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 70939418, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gumCode, windNonTunerCode, millSpeedroidCode], extra: [synchroCode] }, 1: { main: [] } });
    startDuel(session);

    const gum = requireCard(session, gumCode);
    const wind = requireCard(session, windNonTunerCode);
    const synchro = requireCard(session, synchroCode);
    const mill = requireCard(session, millSpeedroidCode);
    moveDuelCard(session.state, gum.uid, "hand", 0);
    moveFaceUpAttack(session, wind, 0);
    mill.sequence = 0;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${synchroCode}.lua`) return synchroProcedureScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gumCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(synchroCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const damage = restoredOpen.host.loadScript("Duel.Damage(0,500,REASON_EFFECT)", "gum-prize-damage-probe.lua");
    expect(damage.ok, damage.error).toBe(true);
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      { sourceUid: gum.uid, eventName: "damageDealt", eventCode: 1111, eventPlayer: 0, eventValue: 500, triggerBucket: "turnOptional" },
    ]);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const damageTrigger = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === gum.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    expect(damageTrigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredDamageTrigger, damageTrigger!);
    expect(restoredDamageTrigger.session.state.cards.find((card) => card.uid === gum.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredDamageTrigger.session.state.flagEffects.filter((flag) => flag.ownerId === gum.uid && flag.code === Number(gumCode))).toHaveLength(1);
    restoredDamageTrigger.session.state.phase = "main1";

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredDamageTrigger.session), source, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    expect(getLuaRestoreLegalActions(restoredQuick, 0).some((action) => action.type === "activateEffect" && action.uid === gum.uid)).toBe(true);
    const synchroProbe = restoredQuick.host.loadScript(`
      local gum=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gumCode}),0,LOCATION_MZONE,0,nil)
      local wind=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${windNonTunerCode}),0,LOCATION_MZONE,0,nil)
      local sync=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      Duel.SynchroSummon(0,sync,gum,Group.FromCards(gum,wind))
    `, "gum-prize-synchro-probe.lua");
    expect(synchroProbe.ok, synchroProbe.error).toBe(true);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
      summonMaterialUids: [gum.uid, wind.uid],
    });

    const restoredMaterialTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredQuick.session), source, reader);
    expectCleanRestore(restoredMaterialTrigger);
    expectRestoredLegalActions(restoredMaterialTrigger, 0);
    const materialTrigger = getLuaRestoreLegalActions(restoredMaterialTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === gum.uid);
    expect(materialTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredMaterialTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredMaterialTrigger, materialTrigger!);

    expect(restoredMaterialTrigger.session.state.cards.find((card) => card.uid === mill.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect, reasonCardUid: gum.uid });
    expect(currentAttack(restoredMaterialTrigger.session.state.cards.find((card) => card.uid === synchro.uid), restoredMaterialTrigger.session.state)).toBe(3200);
    const events = restoredMaterialTrigger.session.state.eventHistory;
    expect(events.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
      },
    ]);
    expect(events.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gum.uid,
        eventUids: [gum.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: gum.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: synchro.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(events.filter((event) => event.eventName === "usedAsMaterial")).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: gum.uid,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: wind.uid,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(events.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === mill.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: mill.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gum.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 2 },
      },
    ]);
  });
});

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

function synchroProcedureScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableReviveLimit()
      Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,1)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
