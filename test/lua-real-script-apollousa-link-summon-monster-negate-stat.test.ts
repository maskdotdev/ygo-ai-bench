import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentBaseAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, linkSummonDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const apollousaCode = "4280258";
const link2MaterialCode = "428025800";
const materialACode = "428025801";
const materialBCode = "428025802";
const opponentMonsterCode = "428025803";
const drawFillerCode = "428025804";
const battleDefenderCode = "428025805";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasApollousaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${apollousaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const raceCyberse = 0x1000000;
const attributeWind = 0x10;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectSetBaseAttack = 103;

describe.skipIf(!hasUpstreamScripts || !hasApollousaScript)("Lua real script Apollousa link summon monster negate stat", () => {
  it("restores Link material-count base ATK and monster-effect activation negation ATK spend", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${apollousaCode}.lua`));
    const reader = createCardReader(cards());
    const source = fixtureSource(workspace);

    const restoredLink = createRestoredLinkSummonField({ reader, source, workspace });
    expectCleanRestore(restoredLink);
    expectRestoredLegalActions(restoredLink, 0);
    const linkApollousa = requireCard(restoredLink.session, apollousaCode);
    const link2Material = requireCard(restoredLink.session, link2MaterialCode);
    const materialA = requireCard(restoredLink.session, materialACode);
    const materialB = requireCard(restoredLink.session, materialBCode);
    expect(linkApollousa.summonMaterialUids).toEqual([link2Material.uid, materialA.uid, materialB.uid]);
    expect(currentBaseAttack(linkApollousa, restoredLink.session.state)).toBe(2400);
    expect(currentAttack(linkApollousa, restoredLink.session.state)).toBe(2400);
    expect(restoredLink.session.state.effects.filter((effect) => effect.sourceUid === linkApollousa.uid && effect.code === effectSetBaseAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: effectSetBaseAttack, reset: { flags: 33492992 }, value: 2400 }]);
    expect(restoredLink.session.state.eventHistory.filter((event) => ["sentToGraveyard", "usedAsMaterial", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: link2Material.uid,
        eventReason: duelReason.material | duelReason.link,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: link2Material.uid,
        eventReason: duelReason.link,
        eventReasonPlayer: 0,
        eventReasonCardUid: linkApollousa.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: materialA.uid,
        eventReason: duelReason.material | duelReason.link,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: materialA.uid,
        eventReason: duelReason.link,
        eventReasonPlayer: 0,
        eventReasonCardUid: linkApollousa.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: materialB.uid,
        eventReason: duelReason.material | duelReason.link,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: materialB.uid,
        eventReason: duelReason.link,
        eventReasonPlayer: 0,
        eventReasonCardUid: linkApollousa.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: linkApollousa.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredOpen = createRestoredNegateField({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const negateApollousa = requireCard(restoredOpen.session, apollousaCode);
    const opponentMonster = requireCard(restoredOpen.session, opponentMonsterCode);
    expect(currentAttack(negateApollousa, restoredOpen.session.state)).toBe(2400);
    const starter = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentMonster.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    if (!starter || starter.type !== "activateEffect") throw new Error("Missing Apollousa opponent monster action");
    const starterEffectId = Number(starter.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredOpen, starter);
    const starterChainLinkId = restoredOpen.session.state.chain.find((link) => link.sourceUid === opponentMonster.uid)?.id;
    expect(starterChainLinkId).toBeDefined();

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === negateApollousa.uid && action.effectId.endsWith("-1027"));
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).not.toContain("apollousa monster starter resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === negateApollousa.uid)).toMatchObject({ attackModifier: -800 });
    expect(currentBaseAttack(restoredResponse.session.state.cards.find((card) => card.uid === negateApollousa.uid), restoredResponse.session.state)).toBe(2400);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === negateApollousa.uid), restoredResponse.session.state)).toBe(1600);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: starterChainLinkId,
        relatedEffectId: starterEffectId,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: starterChainLinkId,
        relatedEffectId: starterEffectId,
      },
    ]);

    restoredResponse.session.state.phase = "battle";
    restoredResponse.session.state.turnPlayer = 0;
    restoredResponse.session.state.waitingFor = 0;
    const battleDefender = requireCard(restoredResponse.session, battleDefenderCode);
    expectRestoredLegalActions(restoredResponse, 0);
    const attack = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "declareAttack" && action.attackerUid === negateApollousa.uid && action.targetUid === battleDefender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, attack!);
    finishRestoredBattle(restoredResponse);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 600 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:SetUniqueOnField(1,0,id)");
  expect(script).toContain("Link.AddProcedure(c,aux.NOT(aux.FilterBoolFunctionEx(Card.IsType,TYPE_TOKEN)),2,99,s.lcheck)");
  expect(script).toContain("return g:CheckDifferentProperty(Card.GetCode,lc,sumtype,tp)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("if not c:IsLinkSummoned() then return end");
  expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
  expect(script).toContain("e1:SetValue(c:GetMaterialCount()*800)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_NEGATE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return not e:GetHandler():IsStatus(STATUS_BATTLE_DESTROYED) and rp==1-tp and re:IsMonsterEffect()");
  expect(script).toContain("Duel.IsChainNegatable(ev)");
  expect(script).toContain("c:IsAttackAbove(800) and c:GetFlagEffect(id)==0");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_CHAIN,0,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,0,0)");
  expect(script).toContain("c:UpdateAttack(-800)==-800");
  expect(script).toContain("Duel.NegateActivation(ev)");
}

function cards(): DuelCardData[] {
  return [
    { code: apollousaCode, name: "Apollousa, Bow of the Goddess", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceFairy, attribute: attributeWind, level: 4, attack: -2, defense: 0, linkMarkers: 135, linkMaterialMin: 2, linkMaterialMax: 99 },
    { code: link2MaterialCode, name: "Apollousa Link-2 Material", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 1600, defense: 0, linkMarkers: 0x20 },
    { code: materialACode, name: "Apollousa Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Apollousa Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentMonsterCode, name: "Apollousa Opponent Monster Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: drawFillerCode, name: "Apollousa Draw Filler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: battleDefenderCode, name: "Apollousa Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${opponentMonsterCode}.lua`) return opponentMonsterScript();
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function opponentMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        Debug.Message("apollousa monster starter resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function createRestoredLinkSummonField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 4280258, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [link2MaterialCode, materialACode, materialBCode], extra: [apollousaCode] }, 1: { main: [] } });
  startDuel(session);
  const apollousa = requireCard(session, apollousaCode);
  const link2Material = requireCard(session, link2MaterialCode);
  const materialA = requireCard(session, materialACode);
  const materialB = requireCard(session, materialBCode);
  moveFaceUpAttack(session, link2Material, 0, 0);
  moveFaceUpAttack(session, materialA, 0, 1);
  moveFaceUpAttack(session, materialB, 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(apollousaCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  linkSummonDuelCard(session.state, 0, apollousa.uid, [link2Material.uid, materialA.uid, materialB.uid]);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredNegateField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 4280259, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [link2MaterialCode, materialACode, materialBCode], extra: [apollousaCode] }, 1: { main: [opponentMonsterCode, drawFillerCode, battleDefenderCode] } });
  startDuel(session);
  const apollousa = requireCard(session, apollousaCode);
  const link2Material = requireCard(session, link2MaterialCode);
  const materialA = requireCard(session, materialACode);
  const materialB = requireCard(session, materialBCode);
  moveFaceUpAttack(session, link2Material, 0, 0);
  moveFaceUpAttack(session, materialA, 0, 1);
  moveFaceUpAttack(session, materialB, 0, 2);
  moveFaceUpAttack(session, requireCard(session, opponentMonsterCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, battleDefenderCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(apollousaCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(opponentMonsterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  linkSummonDuelCard(session.state, 0, apollousa.uid, [link2Material.uid, materialA.uid, materialB.uid]);
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
