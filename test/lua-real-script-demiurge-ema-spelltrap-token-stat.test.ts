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
const demiurgeCode = "26364381";
const tokenCode = "26364382";
const ownSpellCode = "263643810";
const opponentTrapCode = "263643811";
const ownMonsterCode = "263643812";
const responderCode = "263643813";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDemiurgeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${demiurgeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typesToken = 0x4011;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasDemiurgeScript)("Lua real script Demiurge Ema Spell/Trap token stat", () => {
  it("restores cross-field Spell/Trap targets into destroy, dual Token step summon, and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${demiurgeCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_TOKEN+CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.GetTargetGroup(Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)");
    expect(script).toContain("sg:GetClassCount(Card.GetControler,nil)==2");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,0)");
    expect(script).toContain("Duel.SetTargetCard(tg)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,tg,#tg,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,0,2,PLAYER_ALL,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,0,2,PLAYER_ALL,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,1600)");
    expect(script).toContain("local tg=Duel.GetTargetCards(e)");
    expect(script).toContain("Duel.Destroy(tg,REASON_EFFECT)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.SpecialSummonStep(token1,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.SpecialSummonStep(token2,0,tp,1-tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(script).toContain("c:UpdateAttack(1600)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 26364381, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [demiurgeCode, ownSpellCode, ownMonsterCode] }, 1: { main: [opponentTrapCode, responderCode] } });
    startDuel(session);

    const demiurge = requireCard(session, demiurgeCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, demiurge, 0);
    moveFaceUpAttack(session, ownMonster, 0);
    moveDuelCard(session.state, ownSpell.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, opponentTrap.uid, "spellTrapZone", 1).faceUp = true;
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
    expect(host.loadCardScript(Number(demiurgeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === demiurge.uid)!, restoredOpen.session.state)).toBe(3300);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === demiurge.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: demiurge.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetFieldIds: [8, 9],
        targetUids: [ownSpell.uid, opponentTrap.uid],
        operationInfos: [
          { category: 0x1, targetUids: [ownSpell.uid, opponentTrap.uid], count: 2, player: 0, parameter: 0 },
          { category: 0x200, targetUids: [], count: 2, player: 0, parameter: 0 },
          { category: 0x400, targetUids: [], count: 2, player: 0, parameter: 0 },
          { category: 0x200000, targetUids: [demiurge.uid], count: 1, player: 0, parameter: 1600 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("demiurge responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: demiurge.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentTrap.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: demiurge.uid,
      reasonEffectId: 2,
    });
    const tokens = restoredChain.session.state.cards.filter((card) => card.code === tokenCode).sort((a, b) => a.controller - b.controller);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", reasonCardUid: demiurge.uid, reasonEffectId: 2 });
    expect(tokens[1]).toMatchObject({ location: "monsterZone", controller: 1, owner: 0, faceUp: true, position: "faceUpDefense", reasonCardUid: demiurge.uid, reasonEffectId: 2 });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === demiurge.uid)!, restoredChain.session.state)).toBe(4900);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "breakEffect", "specialSummoned"].includes(event.eventName))).toEqual([
      becameTargetEvent(ownSpell.uid, demiurge.uid, 0, "deck", 2),
      becameTargetEvent(opponentTrap.uid, demiurge.uid, 1, "deck", 1),
      destroyedEvent(ownSpell.uid, demiurge.uid, 0, 0),
      destroyedEvent(opponentTrap.uid, demiurge.uid, 1, 0),
      destroyedGroupEvent([ownSpell.uid, opponentTrap.uid], ownSpell.uid, demiurge.uid),
      breakEffectEvent(demiurge.uid),
      specialSummonedEvent([tokens[0]!.uid, tokens[1]!.uid], tokens[0]!.uid, demiurge.uid),
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: demiurgeCode, name: "Demiurge Ema", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 8, attack: 3300, defense: 2400 },
    { code: tokenCode, name: "Homunculus Token", kind: "monster", typeFlags: typesToken, race: raceFairy, attribute: attributeLight, level: 2, attack: 800, defense: 800 },
    { code: ownSpellCode, name: "Demiurge Own Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTrapCode, name: "Demiurge Opponent Trap", kind: "trap", typeFlags: typeTrap },
    { code: ownMonsterCode, name: "Demiurge Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: responderCode, name: "Demiurge Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("demiurge responder resolved") end)
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

function becameTargetEvent(cardUid: string, sourceUid: string, controller: PlayerId, previousLocation: "deck" | "spellTrapZone", previousSequence: number) {
  return {
    eventName: "becameTarget",
    eventCode: 1028,
        eventValue: 1,
    eventCardUid: cardUid,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 2,
    eventChainDepth: 1,
    eventChainLinkId: "chain-2",
    eventPreviousState: { controller, faceUp: false, location: previousLocation, position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, controller: PlayerId, currentSequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller, faceUp: true, location: "graveyard", position: "faceDown", sequence: currentSequence },
  };
}

function destroyedGroupEvent(eventUids: string[], cardUid: string, sourceUid: string) {
  return {
    ...destroyedEvent(cardUid, sourceUid, 0, 0),
    eventUids,
  };
}

function breakEffectEvent(sourceUid: string) {
  return {
    eventName: "breakEffect",
    eventCode: 1050,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
  };
}

function specialSummonedEvent(eventUids: string[], cardUid: string, sourceUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventUids,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 2 },
  };
}
