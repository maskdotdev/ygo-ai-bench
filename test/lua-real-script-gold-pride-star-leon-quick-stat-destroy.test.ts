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
const starLeonCode = "22390469";
const targetCode = "223904690";
const responderCode = "223904691";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasStarLeonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${starLeonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasStarLeonScript)("Lua real script Gold Pride Star Leon quick stat destroy", () => {
  it("restores Quick target ATK gain, possible destroy metadata, SelectYesNo, and BreakEffect destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${starLeonCode}.lua`);
    expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return Duel.IsMainPhase()");
    expect(script).toContain("Duel.SelectTarget(tp,s.cfilter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,0,g:GetFirst():GetBaseAttack())");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_OATH,1)");
    expect(script).toContain("c:UpdateAttack(atk,RESET_EVENT|RESETS_STANDARD,c)==atk");
    expect(script).toContain("Duel.GetLP(tp)<Duel.GetLP(1-tp)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 22390469, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starLeonCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const starLeon = requireCard(session, starLeonCode);
    const target = requireCard(session, targetCode, 1);
    const responder = requireCard(session, responderCode, 1);
    moveFaceUpAttack(session, starLeon, 0);
    moveFaceUpAttack(session, target, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.players[0].lifePoints = 7000;
    session.state.players[1].lifePoints = 8000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starLeonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === starLeon.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: starLeon.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetFieldIds: [5],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x200000, targetUids: [starLeon.uid], count: 1, player: 0, parameter: 2100 }],
        possibleOperationInfos: [{ category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("star leon responder resolved");
    expect(restoredChain.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 358247506, returned: true },
    ]);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === starLeon.uid), restoredChain.session.state)).toBe(4100);
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: starLeon.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "breakEffect", "destroyed"].includes(event.eventName))).toEqual([
      becameTargetEvent(target.uid, starLeon.uid),
      breakEffectEvent(starLeon.uid),
      destroyedEvent(target.uid, starLeon.uid),
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: starLeonCode, name: "Gold Pride - Star Leon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeLight, level: 6, attack: 2000, defense: 2000 },
    { code: targetCode, name: "Star Leon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2100, defense: 1000 },
    { code: responderCode, name: "Star Leon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("star leon responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function becameTargetEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
        eventValue: 1,
    eventCardUid: cardUid,
    eventChainDepth: 1,
    eventChainLinkId: "chain-2",
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 3,
    eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
    eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
}

function breakEffectEvent(sourceUid: string) {
  return {
    eventName: "breakEffect",
    eventCode: 1050,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
  };
}

function destroyedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
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
