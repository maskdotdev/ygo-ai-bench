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
const viciousClawsCode = "35095329";
const heroTargetCode = "350953290";
const nonHeroCode = "350953291";
const responderCode = "350953292";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasViciousClawsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${viciousClawsCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x10;
const setHero = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasViciousClawsScript)("Lua real script Vicious Claws hand summon stat", () => {
  it("restores hand Special Summon in defense into targeted HERO ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${viciousClawsCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.IsExistingTarget(aux.FaceupFilter(Card.IsSetCard,SET_HERO),tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_HERO),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,tp,300)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)>0");
    expect(script).toContain("tc:IsFaceup() and tc:IsRelateToEffect(e)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(300)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 35095329, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [viciousClawsCode, heroTargetCode, nonHeroCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const claws = requireCard(session, viciousClawsCode);
    const heroTarget = requireCard(session, heroTargetCode);
    const nonHero = requireCard(session, nonHeroCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, claws.uid, "hand", 0);
    moveFaceUpAttack(session, heroTarget, 0);
    moveFaceUpAttack(session, nonHero, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(viciousClawsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === claws.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: claws.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetUids: [heroTarget.uid],
        operationInfos: [
          { category: 0x200, targetUids: [claws.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x200000, targetUids: [heroTarget.uid], count: 1, player: 0, parameter: 300 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("vicious claws responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === claws.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: claws.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === heroTarget.uid), restoredChain.session.state)).toBe(2100);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === nonHero.uid), restoredChain.session.state)).toBe(1700);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned", "chainSolved"].includes(event.eventName))).toEqual([
      becameTargetEvent(heroTarget.uid),
      specialSummonedEvent(claws.uid),
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: viciousClawsCode, name: "Evil HERO Vicious Claws", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 7, attack: 2500, defense: 2500, setcodes: [setHero] },
    { code: heroTargetCode, name: "Vicious Claws HERO Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000, setcodes: [setHero] },
    { code: nonHeroCode, name: "Vicious Claws Non-HERO Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: responderCode, name: "Vicious Claws Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("vicious claws responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function becameTargetEvent(cardUid: string) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 1,
    eventChainDepth: 1,
    eventChainLinkId: "chain-2",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
}

function specialSummonedEvent(cardUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventUids: [cardUid],
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 2 },
  };
}
