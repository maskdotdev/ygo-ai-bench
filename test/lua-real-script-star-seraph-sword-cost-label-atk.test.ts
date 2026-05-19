import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const swordCode = "70668285";
const hasSwordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${swordCode}.lua`));
const setStarSeraph = 0x86;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSwordScript)("Lua real script Star Seraph Sword cost-label ATK boost", () => {
  it("restores selected hand cost base ATK through the chain label into its temporary ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const highCostCode = "70668286";
    const lowCostCode = "70668287";
    const offSetCostCode = "70668288";
    const responderCode = "70668289";
    const script = workspace.readScript(`c${swordCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetCountLimit(1)");
    expect(script).toContain("return c:IsSetCard(SET_STAR_SERAPH) and c:GetBaseAttack()>0 and c:IsAbleToGraveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("e:SetLabel(g:GetFirst():GetBaseAttack())");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(e:GetLabel())");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");

    const cards: DuelCardData[] = [
      { code: swordCode, name: "Star Seraph Sword", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setStarSeraph], level: 4, attack: 1400, defense: 1000 },
      { code: highCostCode, name: "Star Seraph Sword High Cost", kind: "monster", typeFlags: typeMonster, setcodes: [setStarSeraph], level: 4, attack: 1800, defense: 1000 },
      { code: lowCostCode, name: "Star Seraph Sword Low Cost", kind: "monster", typeFlags: typeMonster, setcodes: [setStarSeraph], level: 4, attack: 700, defense: 1000 },
      { code: offSetCostCode, name: "Star Seraph Sword Off-Set Cost", kind: "monster", typeFlags: typeMonster, setcodes: [0x123], level: 4, attack: 2400, defense: 1000 },
      { code: responderCode, name: "Star Seraph Sword Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 70668285, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [swordCode, offSetCostCode, highCostCode, lowCostCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const sword = requireCard(session.state.cards, swordCode);
    const highCost = requireCard(session.state.cards, highCostCode);
    const lowCost = requireCard(session.state.cards, lowCostCode);
    const offSetCost = requireCard(session.state.cards, offSetCostCode);
    const responder = requireCard(session.state.cards, responderCode);
    moveFaceUpAttack(session.state, sword);
    moveDuelCard(session.state, highCost.uid, "hand", 0);
    moveDuelCard(session.state, lowCost.uid, "hand", 0);
    moveDuelCard(session.state, offSetCost.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(swordCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.find((effect) => effect.sourceUid === sword.uid)).toMatchObject({
      category: 0x200000,
      countLimit: 1,
      event: "ignition",
      id: "lua-1",
      range: ["monsterZone"],
    });

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sword.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyLuaActionAndAssert(session, activation!);
    expect(session.state.cards.find((card) => card.uid === highCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: sword.uid,
    });
    expect(session.state.cards.find((card) => card.uid === lowCost.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === offSetCost.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.chain).toHaveLength(1);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.cards.find((card) => card.uid === highCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: sword.uid,
    });
    expect(restoredChain.session.state.chain).toHaveLength(1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restoredChain, 1);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === sword.uid), restoredChain.session.state)).toBe(
      (sword.data.attack ?? 0) + (highCost.data.attack ?? 0),
    );
    expect(restoredChain.host.messages).not.toContain("star seraph sword responder resolved");

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === sword.uid), restoredBoost.session.state)).toBe(
      (sword.data.attack ?? 0) + (highCost.data.attack ?? 0),
    );
    expect(getLuaRestoreLegalActions(restoredBoost, 0).some((action) => action.type === "activateEffect" && action.uid === sword.uid)).toBe(false);

    endTurn(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === sword.uid), restoredBoost.session.state)).toBe(sword.data.attack);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("star seraph sword responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(state: ReturnType<typeof createDuel>["state"], card: DuelCardInstance): void {
  moveDuelCard(state, card.uid, "monsterZone", 0);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}

function endTurn(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "endTurn");
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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

function applyLuaActionAndAssert(session: ReturnType<typeof createDuel>, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
