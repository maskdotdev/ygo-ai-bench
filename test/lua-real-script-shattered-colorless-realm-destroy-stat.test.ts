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
const realmCode = "44553392";
const viciousCode = "65815684";
const targetCode = "445533920";
const responderCode = "445533921";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRealmScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${realmCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasRealmScript)("Lua real script Shattered Colorless Realm destroy stat", () => {
  it("restores target destruction into optional Vicious Astroud ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${realmCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,65815684),0,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_REMOVED)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsCode,65815684),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()");
    expect(script).toContain("Duel.HintSelection(sc,true)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1500)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 44553392, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [realmCode, targetCode, viciousCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const realm = requireCard(session, realmCode);
    const target = requireCard(session, targetCode);
    const vicious = requireCard(session, viciousCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, realm.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, vicious, 0);
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
    expect(host.loadCardScript(Number(realmCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === realm.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: realm.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [6],
        targetUids: [target.uid],
        operationInfos: [
          { category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
        ],
        possibleOperationInfos: [
          { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x20 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 712854274, returned: true },
    ]);
    expect(restoredChain.host.messages).not.toContain("shattered realm responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: realm.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === vicious.uid), restoredChain.session.state)).toBe(4500);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      becameTargetEvent(target.uid),
      destroyedEvent(target.uid, realm.uid),
      sentToGraveyardEvent(target.uid, realm.uid),
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: realm.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
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
    { code: realmCode, name: "A Shattered, Colorless Realm", kind: "spell", typeFlags: typeSpell },
    { code: targetCode, name: "Colorless Realm Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: viciousCode, name: "Vicious Astroud", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 8, attack: 3000, defense: 3000 },
    { code: responderCode, name: "Colorless Realm Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("shattered realm responder resolved") end)
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
    eventValue: 1,
    eventReason: 0,
    eventReasonPlayer: 0,
    relatedEffectId: 1,
    eventChainDepth: 1,
    eventChainLinkId: "chain-2",
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
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
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
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
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}
