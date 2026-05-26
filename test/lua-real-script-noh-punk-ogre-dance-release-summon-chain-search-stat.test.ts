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
const ogreCode = "81914447";
const searchTargetCode = "819144470";
const chainStarterCode = "819144471";
const costCodes = ["819144472", "819144473", "819144474", "819144475", "819144476"] as const;
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasOgreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ogreCode}.lua`));
const setPunk = 0x173;
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePsychic = 0x400;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasOgreScript)("Lua real script Noh-P.U.N.K. Ogre Dance release summon chain search stat", () => {
  it("restores full-field release Special Summon, self-to-Grave search, and opponent monster chain ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ogreCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const source = sourceWithStarter(workspace);

    const restoredSummon = createRestoredOgreField({ reader, source, workspace, scenario: "releaseSummon" });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonOgre = requireCard(restoredSummon.session, ogreCode);
    const summonAction = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonOgre.uid && action.effectId === "lua-2"
    );
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonAction!);

    const releasedCost = restoredSummon.session.state.cards.find((card) => costCodes.includes(card.code as typeof costCodes[number]) && card.location === "graveyard");
    expect(releasedCost).toBeDefined();
    expect(releasedCost).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: summonOgre.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonOgre.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      sequence: 0,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonOgre.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: releasedCost!.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: summonOgre.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: summonOgre.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: summonOgre.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand", current: "monsterZone" },
    ]);

    const restoredSearch = createRestoredOgreField({ reader, source, workspace, scenario: "search" });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchOgre = requireCard(restoredSearch.session, ogreCode);
    const searchTarget = requireCard(restoredSearch.session, searchTargetCode);
    const searchAction = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateEffect" && action.uid === searchOgre.uid
    );
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchAction!);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchOgre.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: searchOgre.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearch.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchOgre.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${searchTargetCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: searchOgre.uid, eventCode: 1014, eventName: "sentToGraveyard", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: searchOgre.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: searchOgre.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchOgre.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: searchOgre.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "deck", current: "hand" },
    ]);

    const restoredChainOpen = createRestoredOgreField({ reader, source, workspace, scenario: "chain" });
    expectCleanRestore(restoredChainOpen);
    expectRestoredLegalActions(restoredChainOpen, 1);
    const chainOgre = requireCard(restoredChainOpen.session, ogreCode);
    const chainStarter = requireCard(restoredChainOpen.session, chainStarterCode);
    const starter = getLuaRestoreLegalActions(restoredChainOpen, 1).find((action) =>
      action.type === "activateEffect" && action.uid === chainStarter.uid
    );
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredChainOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChainOpen, starter!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredChainOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const chainGain = getLuaRestoreLegalActions(restoredResponse, 0).find((action) =>
      action.type === "activateEffect" && action.uid === chainOgre.uid
    );
    expect(chainGain, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, chainGain!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).toContain("noh punk ogre dance chain starter resolved");
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === chainOgre.uid), restoredResponse.session.state)).toBe((chainOgre.data.attack ?? 0) + (chainStarter.data.attack ?? 0));
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === chainOgre.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107235328 }, sourceUid: chainOgre.uid, value: chainStarter.data.attack },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["chaining", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: chainStarter.uid, eventChainDepth: 1, eventChainLinkId: "chain-2", eventCode: 1027, eventName: "chaining", eventPlayer: 1, eventReasonPlayer: 1, eventValue: 1, relatedEffectId: 4 },
      { eventCardUid: chainOgre.uid, eventChainDepth: 2, eventChainLinkId: "chain-3", eventCode: 1027, eventName: "chaining", eventPlayer: 0, eventReasonPlayer: 0, eventValue: 2, relatedEffectId: 1 },
      { eventCardUid: undefined, eventChainDepth: 2, eventChainLinkId: "chain-3", eventCode: 1022, eventName: "chainSolved", eventPlayer: 0, eventReasonPlayer: 0, eventValue: 2, relatedEffectId: 1 },
      { eventCardUid: undefined, eventChainDepth: 1, eventChainLinkId: "chain-2", eventCode: 1022, eventName: "chainSolved", eventPlayer: 1, eventReasonPlayer: 1, eventValue: 1, relatedEffectId: 4 },
    ]);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOgreField({
  reader,
  source,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "releaseSummon" | "search" | "chain";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "releaseSummon" ? 81914447 : scenario === "search" ? 81914448 : 81914449, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  const playerMain = scenario === "releaseSummon" ? [ogreCode, ...costCodes] : scenario === "search" ? [ogreCode, searchTargetCode] : [ogreCode];
  loadDecks(session, { 0: { main: playerMain }, 1: { main: [chainStarterCode] } });
  startDuel(session);
  const ogre = requireCard(session, ogreCode);
  if (scenario === "releaseSummon") {
    moveDuelCard(session.state, ogre.uid, "hand", 0);
    costCodes.forEach((code, sequence) => moveFaceUpAttack(session, requireCard(session, code), 0, sequence));
  } else if (scenario === "search") {
    moveFaceUpAttack(session, ogre, 0, 0);
  } else {
    moveFaceUpAttack(session, ogre, 0, 0);
    moveFaceUpAttack(session, requireCard(session, chainStarterCode), 1, 0);
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;
  }
  session.state.phase = "main1";
  if (scenario !== "chain") {
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
  }
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ogreCode), source).ok).toBe(true);
  if (scenario === "chain") expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "chain" ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Noh-P.U.N.K. Ogre Dance");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return rp==1-tp and re:IsMonsterEffect() and re:GetHandler():GetBaseAttack()>0");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsSetCard,1,false,aux.ReleaseCheckMMZ,nil,SET_PUNK)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsSetCard,1,1,false,aux.ReleaseCheckMMZ,nil,SET_PUNK)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e:GetHandler():IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e3:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("return c:IsMonster() and c:IsSetCard(SET_PUNK) and not c:IsLevel(8) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const ogre = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ogreCode);
  expect(ogre).toBeDefined();
  return [
    { ...ogre!, kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeDark, level: 8, attack: 2500, defense: 2000, setcodes: [setPunk] },
    { code: searchTargetCode, name: "Noh-P.U.N.K. Ogre Dance Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 3, attack: 600, defense: 600, setcodes: [setPunk] },
    { code: chainStarterCode, name: "Noh-P.U.N.K. Ogre Dance Chain Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    ...costCodes.map((code, index): DuelCardData => ({ code, name: `Noh-P.U.N.K. Ogre Dance Release ${index + 1}`, kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeEarth, level: 3, attack: 500 + index * 100, defense: 500, setcodes: [setPunk] })),
  ];
}

function sourceWithStarter(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
      return workspace.readScript(name);
    },
  };
}

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        Debug.Message("noh punk ogre dance chain starter resolved")
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
