import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const brightCode = "72402069";
const destroyerCode = "724020690";
const hasBrightScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${brightCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setDDD = 0xaf;

describe.skipIf(!hasUpstreamScripts || !hasBrightScript)("Lua real script D/D/D Super Doom King Bright Armageddon destroyed PZone", () => {
  it("restores destroyed-from-monster-zone trigger placement into its Pendulum Zone", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${brightCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 72402069, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destroyerCode], extra: [brightCode] }, 1: { main: [] } });
    startDuel(session);

    const bright = requireCard(session, brightCode);
    const destroyer = requireCard(session, destroyerCode);
    moveFaceUpAttack(session, bright, 0);
    moveFaceUpAttack(session, destroyer, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(brightCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(brightCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const destroyAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, destroyAction!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === bright.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-9-1029",
        sourceUid: bright.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: bright.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const pzoneTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === bright.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, pzoneTrigger!);

    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === bright.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: bright.uid,
      reasonEffectId: 9,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "moved"].includes(event.eventName))).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: bright.uid,
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
        eventCardUid: bright.uid,
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
        eventCardUid: bright.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bright.uid,
        eventReasonEffectId: 9,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(8000);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: brightCode, name: "D/D/D Super Doom King Bright Armageddon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro | typePendulum, race: raceFiend, attribute: attributeDark, level: 10, attack: 3500, defense: 3000, leftScale: 1, rightScale: 1, setcodes: [setDDD] },
    { code: destroyerCode, name: "Bright Armageddon Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--D/D/D Super Doom King Bright Armageddon");
  expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_DD),1,1,Synchro.NonTunerEx(Card.IsSetCard,SET_DDD),1,99)");
  expect(script).toContain("Pendulum.AddProcedure(c,false)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsDefenseBelow,c:GetAttack()),tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e3a:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3b:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsNegatableMonster,tp,0,LOCATION_MZONE,1,c)");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("Duel.CheckPendulumZones(tp)");
  expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: ReturnType<typeof requireCard>, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
