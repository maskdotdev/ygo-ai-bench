import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const shogiLanceCode = "32476434";
const hasShogiLanceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shogiLanceCode}.lua`));
const targetCode = "32476435";
const decoyCode = "32476436";
const responderCode = "32476437";
const typeMonster = 0x1;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasShogiLanceScript)("Lua real script Shogi Lance summed Level change", () => {
  it("restores targeted Level-3 Beast-Warrior selection into summed Level changes on both monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${shogiLanceCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCountLimit(1)");
    expect(script).toContain("return c:IsFaceup() and c:GetLevel()==3 and c:IsRace(RACE_BEASTWARRIOR)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,e:GetHandler())");
    expect(script).toContain("local lv=c:GetLevel()+tc:GetLevel()");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("tc:RegisterEffect(e2)");

    const cards: DuelCardData[] = [
      { code: shogiLanceCode, name: "Shogi Lance", kind: "monster", typeFlags: typeMonster, race: raceBeastWarrior, level: 4, attack: 500, defense: 500 },
      { code: targetCode, name: "Shogi Lance Level-3 Beast-Warrior Target", kind: "monster", typeFlags: typeMonster, race: raceBeastWarrior, level: 3, attack: 1000, defense: 1000 },
      { code: decoyCode, name: "Shogi Lance Non-Beast-Warrior Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 3, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Shogi Lance Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 32476434, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shogiLanceCode, targetCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const shogiLance = requireCard(session, shogiLanceCode);
    const target = requireCard(session, targetCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, shogiLance, 0);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, decoy, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    expect(currentLevel(shogiLance, session.state)).toBe(4);
    expect(currentLevel(target, session.state)).toBe(3);
    expect(currentLevel(decoy, session.state)).toBe(3);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shogiLanceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === shogiLance.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: shogiLance.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [target.uid],
      },
    ]);
    expect(restoredActivation.session.state.chain[0]?.targetUids).not.toContain(decoy.uid);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("shogi lance responder resolved");

    const restoredShogiLance = restoredChain.session.state.cards.find((card) => card.uid === shogiLance.uid);
    const restoredTarget = restoredChain.session.state.cards.find((card) => card.uid === target.uid);
    const restoredDecoy = restoredChain.session.state.cards.find((card) => card.uid === decoy.uid);
    expect(currentLevel(restoredShogiLance, restoredChain.session.state)).toBe(7);
    expect(currentLevel(restoredTarget, restoredChain.session.state)).toBe(7);
    expect(currentLevel(restoredDecoy, restoredChain.session.state)).toBe(3);
    expect(restoredChain.session.state.effects.filter((effect) => effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
      value: effect.value,
      reset: effect.reset,
    }))).toEqual([
      {
        code: effectChangeLevel,
        controller: 0,
        event: "continuous",
        property: 1024,
        sourceUid: shogiLance.uid,
        value: 7,
        reset: { flags: 33427456 },
      },
      {
        code: effectChangeLevel,
        controller: 0,
        event: "continuous",
        property: 1024,
        sourceUid: target.uid,
        value: 7,
        reset: { flags: 33427456 },
      },
    ]);

    const restoredAfterLevel = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterLevel);
    expectRestoredLegalActions(restoredAfterLevel, 0);
    expect(currentLevel(restoredAfterLevel.session.state.cards.find((card) => card.uid === shogiLance.uid), restoredAfterLevel.session.state)).toBe(7);
    expect(currentLevel(restoredAfterLevel.session.state.cards.find((card) => card.uid === target.uid), restoredAfterLevel.session.state)).toBe(7);
    assertLuaLevel(restoredAfterLevel, shogiLanceCode, 7);
    assertLuaLevel(restoredAfterLevel, targetCode, 7);
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
      e:SetOperation(function(e,tp) Debug.Message("shogi lance responder resolved") end)
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
      Debug.Message("shogi lance level " .. tostring(target and target:GetLevel()))
    `,
    `shogi-lance-level-${code}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`shogi lance level ${expected}`);
}
