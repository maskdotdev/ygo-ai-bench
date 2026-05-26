import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const silentStriderCode = "18235577";
const hasSilentStriderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${silentStriderCode}.lua`));
const targetCode = "18235578";
const xyzDecoyCode = "18235579";
const responderCode = "18235580";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const effectUpdateLevel = 130;

describe.skipIf(!hasUpstreamScripts || !hasSilentStriderScript)("Lua real script Silent Strider self-to-Grave target Level update", () => {
  it("restores hand SelfToGrave cost into targeted EFFECT_UPDATE_LEVEL resolution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${silentStriderCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("return c:IsFaceup() and not c:IsType(TYPE_XYZ)");
    expect(script).toContain("Duel.IsExistingTarget(s.lvfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
    expect(script).toContain("e1:SetValue(-1)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const cards: DuelCardData[] = [
      { code: silentStriderCode, name: "Silent Strider", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 300, defense: 700 },
      { code: targetCode, name: "Silent Strider Level Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1200 },
      { code: xyzDecoyCode, name: "Silent Strider Xyz Decoy", kind: "monster", typeFlags: typeMonster | typeXyz, level: 4, attack: 1800, defense: 1600 },
      { code: responderCode, name: "Silent Strider Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18235577, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [silentStriderCode, targetCode, xyzDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const silentStrider = requireCard(session, silentStriderCode);
    const target = requireCard(session, targetCode);
    const xyzDecoy = requireCard(session, xyzDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, silentStrider.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, xyzDecoy, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    expect(currentLevel(target, session.state)).toBe(4);
    expect(currentLevel(xyzDecoy, session.state)).toBe(4);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(silentStriderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === silentStrider.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: silentStrider.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [6],
        targetUids: [target.uid],
      },
    ]);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === silentStrider.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonCardUid: silentStrider.uid,
      reasonEffectId: 1,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("silent strider responder resolved");

    const restoredTarget = restoredChain.session.state.cards.find((card) => card.uid === target.uid);
    const restoredXyzDecoy = restoredChain.session.state.cards.find((card) => card.uid === xyzDecoy.uid);
    expect(currentLevel(restoredTarget, restoredChain.session.state)).toBe(3);
    expect(currentLevel(restoredXyzDecoy, restoredChain.session.state)).toBe(4);
    expect(restoredChain.session.state.effects.filter((effect) => effect.code === effectUpdateLevel).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
      reset: effect.reset,
    }))).toEqual([
      {
        code: effectUpdateLevel,
        controller: 0,
        event: "continuous",
        sourceUid: target.uid,
        value: -1,
        reset: { flags: 1107169792 },
      },
    ]);

    const restoredAfterLevel = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterLevel);
    expectRestoredLegalActions(restoredAfterLevel, 0);
    expect(currentLevel(restoredAfterLevel.session.state.cards.find((card) => card.uid === target.uid), restoredAfterLevel.session.state)).toBe(3);
    assertLuaLevel(restoredAfterLevel, targetCode, 3);
    expect(restoredAfterLevel.host.messages).not.toContain("silent strider responder resolved");
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("silent strider responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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

function assertLuaLevel(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: number): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("silent strider level " .. tostring(target and target:GetLevel()))
    `,
    `silent-strider-level-${expected}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`silent strider level ${expected}`);
}
