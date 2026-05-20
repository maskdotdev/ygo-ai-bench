import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const goldDustCode = "16708652";
const hasGoldDustScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${goldDustCode}.lua`));
const sourceKarakuriCode = "167086520";
const boostedKarakuriCode = "167086521";
const decoyCode = "167086522";
const responderCode = "167086523";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setKarakuri = 0x11;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGoldDustScript)("Lua real script Karakuri Gold Dust position copy stat", () => {
  it("restores two-target Damage Step activation into source position change and copied ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${goldDustCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("return Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition()");
    expect(script).toContain("return c:IsPosition(POS_FACEUP_ATTACK) and c:IsCanChangePosition() and c:IsSetCard(SET_KARAKURI)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,g1:GetFirst())");
    expect(script).toContain("local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("Duel.ChangePosition(tc1,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(tc1:GetAttack())");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === goldDustCode),
      { code: sourceKarakuriCode, name: "Karakuri Gold Dust Source", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 1600, defense: 1000 },
      { code: boostedKarakuriCode, name: "Karakuri Gold Dust Boosted", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 1500, defense: 1200 },
      { code: decoyCode, name: "Karakuri Gold Dust Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 1900, defense: 900 },
      { code: responderCode, name: "Karakuri Gold Dust Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 16708652, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [goldDustCode, sourceKarakuriCode, boostedKarakuriCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const goldDust = requireCard(session, goldDustCode);
    const sourceKarakuri = requireCard(session, sourceKarakuriCode);
    const boostedKarakuri = requireCard(session, boostedKarakuriCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, goldDust.uid, "hand", 0);
    moveDuelCard(session.state, sourceKarakuri.uid, "monsterZone", 0).position = "faceUpAttack";
    sourceKarakuri.faceUp = true;
    sourceKarakuri.turnId = 0;
    moveDuelCard(session.state, boostedKarakuri.uid, "monsterZone", 0).position = "faceUpAttack";
    boostedKarakuri.faceUp = true;
    boostedKarakuri.turnId = 0;
    moveDuelCard(session.state, decoy.uid, "monsterZone", 0).position = "faceUpAttack";
    decoy.faceUp = true;
    decoy.turnId = 0;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(goldDustCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === goldDust.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.host.messages).not.toContain("karakuri gold dust responder resolved");
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => event.eventCardUid)).toEqual([
      sourceKarakuri.uid,
      boostedKarakuri.uid,
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "chainSolving" || event.eventName === "chainSolved")).toEqual([
      {
        eventName: "chainSolving",
        eventCode: 1020,
        eventReason: 1024,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventPlayer: 0,
        eventValue: 1,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventCardUid: goldDust.uid,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventValue: 1,
      },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === goldDust.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === sourceKarakuri.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
    });
    const boosted = restoredOpen.session.state.cards.find((card) => card.uid === boostedKarakuri.uid);
    expect(boosted).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true });
    expect(currentAttack(boosted, restoredOpen.session.state)).toBe(3100);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("karakuri gold dust responder resolved") end)
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
