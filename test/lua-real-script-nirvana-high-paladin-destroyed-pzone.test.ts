import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const nirvanaCode = "80896940";
const hasNirvanaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nirvanaCode}.lua`));
const destroyerCode = "808969400";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typePendulum = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasNirvanaScript)("Lua real script Nirvana High Paladin destroyed PZone", () => {
  it("restores destroyed-from-monster-zone trigger placement into the Pendulum Zone", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${nirvanaCode}.lua`);
    expect(script).toContain("Nirvana High Paladin");
    expect(script).toContain("Pendulum.AddProcedure(c,false)");
    expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsType,TYPE_SYNCHRO),1,99,s.matfilter)");
    expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
    expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e2:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
    expect(script).toContain("e4:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(script).toContain("e5:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e6:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("e7:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.CheckPendulumZones(tp)");
    expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");

    const upstreamCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === nirvanaCode);
    expect(upstreamCard).toBeDefined();
    const cards: DuelCardData[] = [
      {
        ...upstreamCard!,
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typeSynchro | typePendulum,
        attack: 3300,
        defense: 2500,
        leftScale: 8,
        rightScale: 8,
      },
      { code: destroyerCode, name: "Nirvana High Paladin Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 80896940, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destroyerCode], extra: [nirvanaCode] }, 1: { main: [] } });
    startDuel(session);

    const nirvana = requireCard(session, nirvanaCode);
    const destroyer = requireCard(session, destroyerCode);
    moveDuelCard(session.state, nirvana.uid, "monsterZone", 0).position = "faceUpAttack";
    nirvana.faceUp = true;
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 0).position = "faceUpAttack";
    destroyer.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(nirvanaCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nirvanaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const destroyAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, destroyAction!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === nirvana.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 1,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const pzoneTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === nirvana.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, pzoneTrigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === nirvana.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: nirvana.uid,
      reasonEffectId: 10,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "moved"].includes(event.eventName))).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: nirvana.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: nirvana.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: nirvana.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: nirvana.uid,
        eventReasonEffectId: 10,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(8000);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function destroyerScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        local tc=Duel.GetFirstMatchingCard(Card.IsCode,tp,LOCATION_MZONE,0,nil,${targetCode})
        if chk==0 then return tc and tc:IsDestructable() end
        Duel.SetTargetCard(tc)
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,tc,1,0,0)
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then Duel.Destroy(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyResponse(restored.session, pass!);
}
