import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const ailinCode = "11678191";
const hasAilinScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ailinCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasAilinScript)("Lua real script Protective Soul Ailin Union position", () => {
  it("restores old-rule Union equip state into its Spell/Trap-zone position ignition", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "84173492";
    const responderCode = "11678192";
    const script = workspace.readScript(`c${ailinCode}.lua`);
    expect(script).toContain("aux.AddUnionProcedure(c,aux.FilterBoolFunction(Card.IsCode,84173492),true)");
    expect(script).toContain("e1:SetRange(LOCATION_SZONE)");
    expect(script).toContain("e1:SetCondition(aux.IsUnionState)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,e:GetHandler():GetEquipTarget(),1,0,0)");
    expect(script).toContain("Duel.ChangePosition(c:GetEquipTarget(),POS_FACEUP_DEFENSE,0,POS_FACEUP_ATTACK,0)");

    const cards = [
      { code: ailinCode, name: "Protective Soul Ailin", kind: "monster" as const, typeFlags: typeMonster | typeEffect, level: 1, attack: 0, defense: 0 },
      { code: targetCode, name: "Protective Soul Ailin Equip Target", kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Protective Soul Ailin Chain Responder", kind: "monster" as const, typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 116, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ailinCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ailin = session.state.cards.find((card) => card.code === ailinCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(ailin).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, ailin!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ailinCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredEquipWindow, 0));

    const equipAction = findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), ailin!.uid, 1068);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);
    resolveRestoredChain(restoredEquipWindow);

    expect(restoredEquipWindow.session.state.cards.find((card) => card.uid === ailin!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });
    expect(restoredEquipWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
    });

    const restoredUnionState = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredUnionState.restoreComplete, restoredUnionState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredUnionState.missingRegistryKeys).toEqual([]);
    expect(restoredUnionState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredUnionState);
    expect(getLuaRestoreLegalActions(restoredUnionState, 0)).toEqual(getDuelLegalActions(restoredUnionState.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredUnionState, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredUnionState, 0));
    expectLuaUnionStateProbe(restoredUnionState, ailinCode, "protective soul ailin union state true/true");

    const positionAction = findEffectActionByCategory(restoredUnionState.session, getLuaRestoreLegalActions(restoredUnionState, 0), ailin!.uid, 0x1000);
    expect(positionAction, JSON.stringify(getLuaRestoreLegalActions(restoredUnionState, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredUnionState, positionAction!);
    expect(restoredUnionState.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
    ]);
    resolveRestoredChain(restoredUnionState);

    expect(restoredUnionState.session.state.cards.find((card) => card.uid === ailin!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });
    expect(restoredUnionState.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(restoredUnionState.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ailin!.uid,
        eventReasonEffectId: 5,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
      },
    ]);
    expect(restoredUnionState.host.messages).not.toContain("protective soul ailin responder resolved");
  });
});

function findEffectAction(session: DuelSession, actions: DuelAction[], uid: string, description: number): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.description === description;
  });
}

function findEffectActionByCategory(session: DuelSession, actions: DuelAction[], uid: string, category: number): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.category === category;
  });
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expectRestoredLegalActions(restored);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectLuaUnionStateProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("protective soul ailin union state " .. tostring(equip and equip:IsHasEffect(EFFECT_UNION_STATUS)~=nil) .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_OLDUNION_STATUS)~=nil))
    `,
    "protective-soul-ailin-union-state-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
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
      e:SetOperation(function(e,tp) Debug.Message("protective soul ailin responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
