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
const kusanagiCode = "74593218";
const materialCode = "745932180";
const trapStarterCode = "745932181";
const defenderCode = "745932182";
const drawCode = "745932183";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKusanagiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kusanagiCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typeTrap = 0x4;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasKusanagiScript)("Lua real script Heroic Champion Kusanagi trap negate stat", () => {
  it("restores trap activation negation, source destruction, detach cost, and self ATK update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kusanagiCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_WARRIOR),4,3)");
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsTrapEffect() and Duel.IsChainNegatable(ev)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(500)");

    const cards: DuelCardData[] = [
      { code: kusanagiCode, name: "Heroic Champion - Kusanagi", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, level: 4, attack: 2500, defense: 2400 },
      { code: materialCode, name: "Kusanagi Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: trapStarterCode, name: "Kusanagi Trap Starter", kind: "trap", typeFlags: typeTrap },
      { code: defenderCode, name: "Kusanagi Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: drawCode, name: "Kusanagi Trap Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 74593218, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [trapStarterCode, defenderCode, drawCode] }, 1: { main: [materialCode], extra: [kusanagiCode] } });
    startDuel(session);

    const trapStarter = requireCard(session, trapStarterCode);
    const defender = requireCard(session, defenderCode);
    const material = requireCard(session, materialCode);
    const kusanagi = requireCard(session, kusanagiCode);
    moveDuelCard(session.state, trapStarter.uid, "spellTrapZone", 0);
    trapStarter.position = "faceDown";
    trapStarter.faceUp = false;
    moveFaceUpAttack(session, defender, 0);
    moveFaceUpAttack(session, kusanagi, 1);
    moveDuelCard(session.state, material.uid, "overlay", 1, duelReason.material | duelReason.xyz, 1);
    kusanagi.overlayUids.push(material.uid);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${trapStarterCode}.lua`) return trapStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trapStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(kusanagiCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredTrapOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrapOpen);
    expectRestoredLegalActions(restoredTrapOpen, 0);
    const trapActivation = getLuaRestoreLegalActions(restoredTrapOpen, 0).find((action) => action.type === "activateEffect" && action.uid === trapStarter.uid);
    expect(trapActivation, JSON.stringify(getLuaRestoreLegalActions(restoredTrapOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrapOpen, trapActivation!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredTrapOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 1);
    const negate = getLuaRestoreLegalActions(restoredResponse, 1).find((action) => action.type === "activateEffect" && action.uid === kusanagi.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.session.state.chain).toEqual([]);
    expect(restoredResponse.host.messages).not.toContain("kusanagi trap starter resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === trapStarter.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: kusanagi.uid,
      reasonEffectId: 3,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.cost,
      reasonPlayer: 1,
      reasonCardUid: kusanagi.uid,
      reasonEffectId: 3,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === kusanagi.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === kusanagi.uid), restoredResponse.session.state)).toBe(3000);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === kusanagi.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x2000, reset: { flags: 33492992 }, value: 500 },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["detachedMaterial", "destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 1,
        eventReasonCardUid: kusanagi.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: trapStarter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: kusanagi.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
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
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === kusanagi.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 2000, 1: 0 });
  });
});

function trapStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("kusanagi trap starter resolved")
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
