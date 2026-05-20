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
const starfishCode = "44717069";
const hasStarfishScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${starfishCode}.lua`));
const decoyCode = "44717070";
const responderCode = "44717071";
const typeMonster = 0x1;
const effectUpdateLevel = 130;

describe.skipIf(!hasUpstreamScripts || !hasStarfishScript)("Lua real script Starfish group update Level", () => {
  it("restores GetMatchingGroup aux.Next Level updates for every face-up Starfish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${starfishCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetCountLimit(1)");
    expect(script).toContain("return c:IsFaceup() and c:IsCode(id)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("tc:RegisterEffect(e1)");

    const cards: DuelCardData[] = [
      { code: starfishCode, name: "Starfish", kind: "monster", typeFlags: typeMonster, level: 3, attack: 300, defense: 300 },
      { code: decoyCode, name: "Starfish Nonmatching Decoy", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Starfish Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 44717069, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starfishCode, starfishCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const starfish = requireCards(session, starfishCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    expect(starfish).toHaveLength(2);
    moveFaceUpAttack(session, starfish[0]!, 0);
    moveFaceUpAttack(session, starfish[1]!, 0);
    moveFaceUpAttack(session, decoy, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    expect(starfish.map((card) => currentLevel(card, session.state))).toEqual([3, 3]);
    expect(currentLevel(decoy, session.state)).toBe(3);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starfishCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === starfish[0]!.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: starfish[0]!.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("starfish responder resolved");

    const restoredStarfish = starfish.map((card) => restoredChain.session.state.cards.find((candidate) => candidate.uid === card.uid)!);
    const restoredDecoy = restoredChain.session.state.cards.find((card) => card.uid === decoy.uid)!;
    expect(restoredStarfish.map((card) => currentLevel(card, restoredChain.session.state))).toEqual([4, 4]);
    expect(currentLevel(restoredDecoy, restoredChain.session.state)).toBe(3);
    expect(restoredChain.session.state.effects.filter((effect) => effect.code === effectUpdateLevel).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
      value: effect.value,
      reset: effect.reset,
    }))).toEqual([
      {
        code: effectUpdateLevel,
        controller: 0,
        event: "continuous",
        property: 1024,
        sourceUid: starfish[0]!.uid,
        value: 1,
        reset: { flags: 33427456 },
      },
      {
        code: effectUpdateLevel,
        controller: 0,
        event: "continuous",
        property: 1024,
        sourceUid: starfish[1]!.uid,
        value: 1,
        reset: { flags: 33427456 },
      },
    ]);

    const restoredAfterLevel = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterLevel);
    expectRestoredLegalActions(restoredAfterLevel, 0);
    expect(starfish.map((card) => currentLevel(restoredAfterLevel.session.state.cards.find((candidate) => candidate.uid === card.uid), restoredAfterLevel.session.state))).toEqual([4, 4]);
    assertLuaGroupLevels(restoredAfterLevel, starfishCode, 4, 2, "starfish level 4");
    assertLuaGroupLevels(restoredAfterLevel, decoyCode, 3, 1, "starfish decoy level 3");
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards.length).toBeGreaterThan(0);
  return cards;
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
      e:SetOperation(function(e,tp) Debug.Message("starfish responder resolved") end)
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

function assertLuaGroupLevels(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expectedLevel: number, expectedCount: number, message: string): void {
  const probe = restored.host.loadScript(
    `
      local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,nil)
      local count=0
      for tc in aux.Next(g) do
        if tc:GetLevel()==${expectedLevel} then count=count+1 end
      end
      Debug.Message("${message} " .. tostring(count))
    `,
    `starfish-level-${code}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`${message} ${expectedCount}`);
}
