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
const phantomClawCode = "13486638";
const raidraptorXyzCode = "134866380";
const phantomMaterialCode = "134866381";
const monsterStarterCode = "134866382";
const defenderCode = "134866383";
const drawCode = "134866384";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPhantomClawScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${phantomClawCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typeTrap = 0x4;
const attributeDark = 0x20;
const raceWingedBeast = 0x200;
const setRaidraptor = 0xba;
const setPhantomKnights = 0x10db;

describe.skipIf(!hasUpstreamScripts || !hasPhantomClawScript)("Lua real script Raidraptor's Phantom Knights Claw detach operated stat", () => {
  it("restores trap monster-effect negate, labeled overlay cost, operated destroy base ATK, and Raidraptor ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${phantomClawCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("return re:IsMonsterEffect() and Duel.IsChainNegatable(ev)");
    expect(script).toContain("local mg=Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("g:Merge(tc:GetOverlayGroup())");
    expect(script).toContain("if sc:IsSetCard({SET_XYZ_DRAGON,SET_THE_PHANTOM_KNIGHTS,SET_RAIDRAPTOR}) then");
    expect(script).toContain("Duel.SendtoGrave(sc,REASON_COST)");
    expect(script).toContain("Duel.RaiseSingleEvent(e:GetHandler(),EVENT_DETACH_MATERIAL,e,0,0,0,0)");
    expect(script).toContain("local atk=Duel.GetOperatedGroup():GetFirst():GetBaseAttack()");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(atk)");

    const cards: DuelCardData[] = [
      { code: phantomClawCode, name: "Raidraptor's Phantom Knights Claw", kind: "trap", typeFlags: typeTrap, setcodes: [setPhantomKnights, setRaidraptor] },
      { code: raidraptorXyzCode, name: "Phantom Claw Raidraptor Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 1900, defense: 1600, setcodes: [setRaidraptor] },
      { code: phantomMaterialCode, name: "Phantom Claw Phantom Knights Material", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 3, attack: 800, defense: 1000, setcodes: [setPhantomKnights] },
      { code: monsterStarterCode, name: "Phantom Claw Monster Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1000 },
      { code: defenderCode, name: "Phantom Claw Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: drawCode, name: "Phantom Claw Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 13486638, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [monsterStarterCode, defenderCode, drawCode] }, 1: { main: [phantomClawCode, phantomMaterialCode], extra: [raidraptorXyzCode] } });
    startDuel(session);

    const phantomClaw = requireCard(session, phantomClawCode);
    const raidraptorXyz = requireCard(session, raidraptorXyzCode);
    const phantomMaterial = requireCard(session, phantomMaterialCode);
    const monsterStarter = requireCard(session, monsterStarterCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, phantomClaw.uid, "spellTrapZone", 1);
    phantomClaw.faceUp = false;
    phantomClaw.position = "faceDown";
    moveFaceUpAttack(session, raidraptorXyz, 1);
    moveDuelCard(session.state, phantomMaterial.uid, "overlay", 1, duelReason.material | duelReason.xyz, 1);
    raidraptorXyz.overlayUids.push(phantomMaterial.uid);
    moveFaceUpAttack(session, monsterStarter, 0);
    moveFaceUpAttack(session, defender, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${monsterStarterCode}.lua`) return monsterStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(monsterStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(phantomClawCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const starter = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === monsterStarter.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starter!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 1);
    const negate = getLuaRestoreLegalActions(restoredResponse, 1).find((action) => action.type === "activateEffect" && action.uid === phantomClaw.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("phantom claw monster starter resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === monsterStarter.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: phantomClaw.uid,
      reasonEffectId: 2,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === phantomMaterial.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.cost,
      reasonPlayer: 1,
      reasonCardUid: phantomClaw.uid,
      reasonEffectId: 2,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === raidraptorXyz.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === raidraptorXyz.uid), restoredResponse.session.state)).toBe(3600);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === raidraptorXyz.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, sourceUid: raidraptorXyz.uid, value: 1700 },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["detachedMaterial", "destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: phantomClaw.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: phantomClaw.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        relatedEffectId: 2,
        eventUids: [phantomClaw.uid],
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: monsterStarter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: phantomClaw.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 1;
    restoredBattle.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === raidraptorXyz.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 2600, 1: 0 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: raidraptorXyz.uid,
        eventPlayer: 0,
        eventValue: 2600,
        eventReason: duelReason.battle,
        eventReasonCardUid: raidraptorXyz.uid,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "extraDeck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function monsterStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("phantom claw monster starter resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
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

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
