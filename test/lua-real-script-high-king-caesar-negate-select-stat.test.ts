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
const caesarCode = "79559912";
const materialCode = "795599120";
const ddAllyCode = "795599121";
const starterCode = "795599122";
const defenderCode = "795599123";
const summonTargetCode = "795599124";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCaesarScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${caesarCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceFiend = 0x8;
const setDd = 0xaf;

describe.skipIf(!hasUpstreamScripts || !hasCaesarScript)("Lua real script D/D/D Wave High King Caesar negate select stat", () => {
  it("restores Special Summon activation negate into optional selected D/D ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${caesarCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_FIEND),6,2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
    expect(script).toContain("return re:IsHasCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)>0");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,c):GetFirst()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetValue(1800)");

    const cards: DuelCardData[] = [
      { code: caesarCode, name: "D/D/D Wave High King Caesar", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceFiend, level: 6, attack: 2800, defense: 1800, setcodes: [setDd] },
      { code: materialCode, name: "High King Caesar Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 6, attack: 1000, defense: 1000, setcodes: [setDd] },
      { code: ddAllyCode, name: "High King Caesar D/D Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1200, defense: 1000, setcodes: [setDd] },
      { code: starterCode, name: "High King Caesar Special Summon Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
      { code: defenderCode, name: "High King Caesar Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: summonTargetCode, name: "High King Caesar Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 79559912, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, defenderCode, summonTargetCode] }, 1: { main: [ddAllyCode, materialCode], extra: [caesarCode] } });
    startDuel(session);

    const caesar = requireCard(session, caesarCode);
    const material = requireCard(session, materialCode);
    const ddAlly = requireCard(session, ddAllyCode);
    const starter = requireCard(session, starterCode);
    const defender = requireCard(session, defenderCode);
    const summonTarget = requireCard(session, summonTargetCode);
    moveFaceUpAttack(session, caesar, 1);
    moveDuelCard(session.state, material.uid, "overlay", 1, duelReason.material | duelReason.xyz, 1);
    caesar.overlayUids.push(material.uid);
    moveFaceUpAttack(session, ddAlly, 1);
    moveFaceUpAttack(session, starter, 0);
    moveFaceUpAttack(session, defender, 0);
    moveDuelCard(session.state, summonTarget.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return specialSummonStarterScript(summonTargetCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(caesarCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const starterAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starterAction!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 1);
    const negate = getLuaRestoreLegalActions(restoredResponse, 1).find((action) => action.type === "activateEffect" && action.uid === caesar.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("high king caesar starter resolved");
    expect(restoredResponse.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 1, description: 1272958593, returned: true },
    ]);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: caesar.uid,
      reasonEffectId: 3,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.cost,
      reasonPlayer: 1,
      reasonCardUid: caesar.uid,
      reasonEffectId: 3,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === caesar.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === caesar.uid), restoredResponse.session.state)).toBe(4600);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === ddAlly.uid), restoredResponse.session.state)).toBe(3000);
    expect(restoredResponse.session.state.effects.filter((effect) => [caesar.uid, ddAlly.uid].includes(effect.sourceUid) && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 1107169792 }, sourceUid: caesar.uid, value: 1800 },
      { code: 100, property: 0x400, reset: { flags: 1107169792 }, sourceUid: ddAlly.uid, value: 1800 },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["detachedMaterial", "destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 1,
        eventReasonCardUid: caesar.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: caesar.uid,
        eventReasonEffectId: 3,
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
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function specialSummonStarterScript(summonTargetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
          and Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode,${summonTargetCode}),tp,LOCATION_HAND,0,1,nil) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("high king caesar starter resolved")
        local g=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${summonTargetCode}),tp,LOCATION_HAND,0,1,1,nil)
        if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP) end
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
