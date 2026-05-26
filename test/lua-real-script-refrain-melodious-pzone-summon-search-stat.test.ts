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
const refrainCode = "64881644";
const fusionTargetCode = "648816440";
const graveTargetCode = "648816441";
const searchTargetCode = "648816442";
const summonStarterCode = "648816443";
const fusionSummonCode = "648816444";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasRefrainScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${refrainCode}.lua`));
const setMelodious = 0x9b;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFairy = 0x4;
const attributeLight = 0x10;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRefrainScript)("Lua real script Refrain Melodious PZone summon search stat", () => {
  it("restores PZone deck send ATK gain, summon-success search, and Extra Deck PZone placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${refrainCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil):GetFirst()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_DELAY,EFFECT_FLAG2_CHECK_SIMULTANEOUS)");
    expect(script).toContain("Duel.CheckPendulumZones(tp)");
    expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");

    const refrainData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === refrainCode);
    expect(refrainData).toBeDefined();
    const cards: DuelCardData[] = [
      refrainData!,
      melodiousFusion(fusionTargetCode, "Refrain Melodious Fusion Target", 2200, 1800, 6),
      melodiousMonster(graveTargetCode, "Refrain Melodious Grave Target", 1000, 1000, 5),
      melodiousMonster(searchTargetCode, "Refrain Melodious Search Target", 1400, 1200, 4),
      { code: summonStarterCode, name: "Refrain Melodious Summon Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
      melodiousFusion(fusionSummonCode, "Refrain Melodious Summoned Fusion", 2400, 2000, 6),
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${summonStarterCode}.lua`) return summonStarterScript(fusionSummonCode);
        const text = workspace.readScript(name);
        if (text === undefined) throw new Error(`missing script ${name}`);
        return text;
      },
    };

    const restoredPzone = createRestoredRefrainDuel({ mode: "pzoneStat", reader, source, workspace });
    expectCleanRestore(restoredPzone);
    expectRestoredLegalActions(restoredPzone, 0);
    const pzoneRefrain = requireCard(restoredPzone.session, refrainCode);
    const fusionTarget = requireCard(restoredPzone.session, fusionTargetCode);
    const graveTarget = requireCard(restoredPzone.session, graveTargetCode);
    const statAction = getLuaRestoreLegalActions(restoredPzone, 0).find((action) => action.type === "activateEffect" && action.uid === pzoneRefrain.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredPzone, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzone, statAction!);
    resolveRestoredChain(restoredPzone);
    expect(restoredPzone.session.state.cards.find((card) => card.uid === graveTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: pzoneRefrain.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredPzone.session.state.cards.find((card) => card.uid === fusionTarget.uid), restoredPzone.session.state)).toBe(3200);
    expect(restoredPzone.session.state.effects.filter((effect) => effect.sourceUid === fusionTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169792 }, sourceUid: fusionTarget.uid, value: 1000 },
    ]);
    expect(restoredPzone.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredPzone.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: fusionTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pzoneRefrain.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredSummon = createRestoredRefrainDuel({ mode: "normalSearch", reader, source, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const handRefrain = requireCard(restoredSummon.session, refrainCode);
    const searchTarget = requireCard(restoredSummon.session, searchTargetCode);
    const normalSummon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === handRefrain.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, normalSummon!);
    const searchTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === handRefrain.uid);
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, searchTrigger!);
    resolveRestoredChain(restoredSummon);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: handRefrain.uid,
      reasonEffectId: 4,
    });
    expect(restoredSummon.host.messages).toContain(`confirmed 1: ${searchTargetCode}`);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToHand", "confirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: handRefrain.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: handRefrain.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: searchTarget.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [searchTarget.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: handRefrain.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredExtra = createRestoredRefrainDuel({ mode: "extraPzone", reader, source, workspace });
    expectCleanRestore(restoredExtra);
    expectRestoredLegalActions(restoredExtra, 0);
    const extraRefrain = requireCard(restoredExtra.session, refrainCode);
    const summonStarter = requireCard(restoredExtra.session, summonStarterCode);
    const summonedFusion = requireCard(restoredExtra.session, fusionSummonCode);
    const summonFusion = getLuaRestoreLegalActions(restoredExtra, 0).find((action) => action.type === "activateEffect" && action.uid === summonStarter.uid);
    expect(summonFusion, JSON.stringify(getLuaRestoreLegalActions(restoredExtra, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredExtra, summonFusion!);
    resolveRestoredChain(restoredExtra);
    expect(restoredExtra.session.state.cards.find((card) => card.uid === summonedFusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonStarter.uid,
      reasonEffectId: 1,
    });
    const pzoneTrigger = getLuaRestoreLegalActions(restoredExtra, 0).find((action) => action.type === "activateTrigger" && action.uid === extraRefrain.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredExtra, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredExtra, pzoneTrigger!);
    expect(restoredExtra.session.state.chain).toEqual([]);
    expect(restoredExtra.session.state.cards.find((card) => card.uid === extraRefrain.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: extraRefrain.uid,
      reasonEffectId: 7,
    });
    expect(restoredExtra.session.state.eventHistory.filter((event) => ["specialSummoned", "moved"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonedFusion.uid,
        eventUids: [summonedFusion.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonStarter.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: extraRefrain.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: extraRefrain.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function melodiousMonster(code: string, name: string, attack: number, defense: number, level: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, level, attack, defense, race: raceFairy, attribute: attributeLight, setcodes: [setMelodious] };
}

function melodiousFusion(code: string, name: string, attack: number, defense: number, level: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect | typeFusion, level, attack, defense, race: raceFairy, attribute: attributeLight, setcodes: [setMelodious] };
}

function createRestoredRefrainDuel({
  mode,
  reader,
  source,
  workspace,
}: {
  mode: "pzoneStat" | "normalSearch" | "extraPzone";
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: `64881644-${mode}`, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: {
      main: mode === "pzoneStat" ? [refrainCode, fusionTargetCode, graveTargetCode] : mode === "normalSearch" ? [refrainCode, searchTargetCode] : [summonStarterCode, fusionSummonCode],
      extra: mode === "extraPzone" ? [refrainCode] : [],
    },
    1: { main: [] },
  });
  startDuel(session);
  if (mode === "pzoneStat") {
    const refrain = requireCard(session, refrainCode);
    const fusionTarget = requireCard(session, fusionTargetCode);
    const graveTarget = requireCard(session, graveTargetCode);
    moveDuelCard(session.state, refrain.uid, "spellTrapZone", 0);
    refrain.faceUp = true;
    moveFaceUpAttack(session, fusionTarget, 0, 0);
    setDeckSequence(graveTarget, 0);
  } else if (mode === "normalSearch") {
    moveDuelCard(session.state, requireCard(session, refrainCode).uid, "hand", 0);
    setDeckSequence(requireCard(session, searchTargetCode), 0);
  } else {
    const refrain = requireCard(session, refrainCode);
    const starter = requireCard(session, summonStarterCode);
    const fusion = requireCard(session, fusionSummonCode);
    setDeckSequence(refrain, 0);
    refrain.location = "extraDeck";
    refrain.faceUp = true;
    moveFaceUpAttack(session, starter, 0, 0);
    moveDuelCard(session.state, fusion.uid, "hand", 0);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(refrainCode), source).ok).toBe(true);
  if (mode === "extraPzone") expect(host.loadCardScript(Number(summonStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(mode === "extraPzone" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function summonStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(function(tc) return tc:IsCode(${targetCode}) and tc:IsCanBeSpecialSummoned(e,0,tp,false,false) end,tp,LOCATION_HAND,0,1,nil) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,function(tc) return tc:IsCode(${targetCode}) end,tp,LOCATION_HAND,0,1,1,nil)
        if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.location = "deck";
  card.controller = 0;
  card.sequence = sequence;
  card.faceUp = false;
  card.position = "faceDown";
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
