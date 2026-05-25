import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const trivikarmaCode = "7436169";
const hasTrivikarmaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${trivikarmaCode}.lua`));
const visasCode = "56099748";
const opponentTargetCode = "74361690";
const searchCode = "74361691";
const decoyCode = "74361692";
const responderCode = "74361693";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasTrivikarmaScript)("Lua real script Trivikarma select group disable search", () => {
  it("restores SelectUnselectGroup two-target activation into opponent disable and Visas ATK gain", () => {
    const { workspace, source } = sourceWithResponder();
    const script = workspace.readScript(`official/c${trivikarmaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,s.rescon,0)");
    expect(script).toContain("Duel.SetTargetCard(tg)");
    expect(script).toContain("Duel.GetTargetCards(e)");
    expect(script).toContain("Duel.NegateRelatedChain(tc2,RESET_TURN_SET)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("local val=math.max(tc2:GetBaseAttack(),tc2:GetBaseDefense())/2");
    expect(script).toContain("tc1:UpdateAttack(val,RESET_EVENT|RESETS_STANDARD,c)");

    const reader = createCardReader(trivikarmaCards());
    const session = createDuel({ seed: 7436169, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [trivikarmaCode, visasCode] }, 1: { main: [opponentTargetCode, responderCode] } });
    startDuel(session);

    const trivikarma = requireCard(session, trivikarmaCode);
    const visas = requireCard(session, visasCode);
    const opponentTarget = requireCard(session, opponentTargetCode, 1);
    const responder = requireCard(session, responderCode, 1);
    const setTrivikarma = moveDuelCard(session.state, trivikarma.uid, "spellTrapZone", 0);
    setTrivikarma.position = "faceDown";
    setTrivikarma.faceUp = false;
    moveFaceUpAttack(session, visas, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [trivikarmaCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === trivikarma.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        effectLabelObjectUid: visas.uid,
        sourceUid: trivikarma.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetFieldIds: [visas.fieldId, opponentTarget.fieldId],
        targetUids: [visas.uid, opponentTarget.uid],
        operationInfos: [
          { category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [opponentTarget.uid] },
          { category: 0x200000, count: 1, parameter: 0, player: 0, targetUids: [visas.uid] },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("trivikarma responder resolved");

    const restoredVisas = requireCard(restoredChain.session, visasCode);
    const restoredTarget = requireCard(restoredChain.session, opponentTargetCode, 1);
    expect(currentAttack(restoredVisas, restoredChain.session.state)).toBe(2700);
    expect(restoredVisas.attackModifier).toBe(600);
    expect(isCardDisabled(restoredChain.session.state, restoredTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.code !== undefined && [opponentTarget.uid, visas.uid, trivikarma.uid].includes(effect.sourceUid) && [2, 8].includes(effect.code)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 2, reset: { flags: 33427456 }, sourceUid: opponentTarget.uid, value: undefined },
      { code: 8, reset: { flags: 33427456 }, sourceUid: opponentTarget.uid, value: 131072 },
    ]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === trivikarma.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => event.eventCardUid)).toEqual([visas.uid, opponentTarget.uid]);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores grave Cost.SelfBanish into Visas-listed Spell/Trap search and confirmation", () => {
    const { workspace, source } = sourceWithResponder();
    const script = workspace.readScript(`official/c${trivikarmaCode}.lua`);
    expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("return c:ListsCode(CARD_VISAS_STARFROST) and c:IsSpellTrap() and c:IsAbleToHand() and not c:IsCode(id)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const reader = createCardReader(trivikarmaCards());
    const session = createDuel({ seed: 7436170, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [trivikarmaCode, searchCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const trivikarma = requireCard(session, trivikarmaCode);
    const searchTarget = requireCard(session, searchCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode, 1);
    moveDuelCard(session.state, trivikarma.uid, "graveyard", 0).turnId = 0;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [trivikarmaCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === trivikarma.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === trivikarma.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: trivikarma.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("trivikarma responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: trivikarma.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => event.eventName)).toEqual([
      "banished",
      "sentToHand",
      "confirmed",
      "sentToHandConfirmed",
    ]);
  });
});

function sourceWithResponder() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  return {
    workspace,
    source: {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    },
  };
}

function trivikarmaCards(): DuelCardData[] {
  return [
    { code: trivikarmaCode, name: "Trivikarma", kind: "trap", typeFlags: typeTrap },
    { code: visasCode, name: "Visas Starfrost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 6, attack: 2100, defense: 1500 },
    { code: opponentTargetCode, name: "Trivikarma Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1200 },
    { code: searchCode, name: "Trivikarma Visas Search Spell", kind: "spell", typeFlags: typeSpell, listedNames: [visasCode] },
    { code: decoyCode, name: "Trivikarma Listed Monster Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, listedNames: [visasCode], level: 4, attack: 1200, defense: 1200 },
    { code: responderCode, name: "Trivikarma Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("trivikarma responder resolved") end)
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
