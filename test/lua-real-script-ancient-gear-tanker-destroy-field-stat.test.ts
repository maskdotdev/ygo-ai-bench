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
const tankerCode = "91098230";
const destroyTargetCode = "910982300";
const golemCode = "83104731";
const mentionsGolemCode = "910982301";
const decoyCode = "910982302";
const responderCode = "910982303";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTankerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tankerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const setAncientGear = 0x7;

describe.skipIf(!hasUpstreamScripts || !hasTankerScript)("Lua real script Ancient Gear Tanker destroy field stat", () => {
  it("restores self-field target destruction into Golem-family ATK boost until End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tankerCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("if chkc then return chkc:IsOnField() and chkc:IsControler(tp) and chkc:IsFaceup() end");
    expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_ONFIELD,0,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("tc:IsRelateToEffect(e) and Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("c:IsCode(CARD_ANCIENT_GEAR_GOLEM) or c:ListsCode(CARD_ANCIENT_GEAR_GOLEM)");
    expect(script).toContain("e1:SetValue(600)");
    expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END)");
    expect(script).toContain("aux.RegisterClientHint(c,0,tp,1,0,aux.Stringid(id,2))");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 91098230, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destroyTargetCode, tankerCode, golemCode, mentionsGolemCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const tanker = requireCard(session, tankerCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    const golem = requireCard(session, golemCode);
    const mentionsGolem = requireCard(session, mentionsGolemCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, tanker, 0);
    moveDuelCard(session.state, destroyTarget.uid, "spellTrapZone", 0);
    destroyTarget.faceUp = true;
    destroyTarget.position = "faceUpAttack";
    moveFaceUpAttack(session, golem, 0);
    moveFaceUpAttack(session, mentionsGolem, 0);
    moveFaceUpAttack(session, decoy, 0);
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
    expect(host.loadCardScript(Number(tankerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === tanker.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3",
        sourceUid: tanker.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [destroyTarget.uid],
        operationInfos: [{ category: 0x1, targetUids: [destroyTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("ancient gear tanker responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: tanker.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === golem.uid), restoredChain.session.state)).toBe(3600);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === mentionsGolem.uid), restoredChain.session.state)).toBe(2200);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === decoy.uid), restoredChain.session.state)).toBe(1700);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === tanker.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1073742336 }, targetRange: [4, 0], value: 600 },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      becameTargetEvent(destroyTarget.uid),
      destroyedEvent(destroyTarget.uid, tanker.uid),
      sentToGraveyardEvent(destroyTarget.uid, tanker.uid),
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: tankerCode, name: "Ancient Gear Tanker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1300, defense: 1300, setcodes: [setAncientGear] },
    { code: destroyTargetCode, name: "Ancient Gear Tanker Face-up Target", kind: "spell", typeFlags: typeSpell, setcodes: [setAncientGear] },
    { code: golemCode, name: "Ancient Gear Golem", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 8, attack: 3000, defense: 3000, setcodes: [setAncientGear] },
    { code: mentionsGolemCode, name: "Ancient Gear Golem Mentioner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000, setcodes: [setAncientGear], listedNames: [golemCode] },
    { code: decoyCode, name: "Ancient Gear Tanker Non-Golem Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000, setcodes: [setAncientGear] },
    { code: responderCode, name: "Ancient Gear Tanker Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("ancient gear tanker responder resolved") end)
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
    relatedEffectId: 3,
    eventChainDepth: 1,
    eventChainLinkId: "chain-2",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
  };
}

function destroyedEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function sentToGraveyardEvent(cardUid: string, reasonCardUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}
