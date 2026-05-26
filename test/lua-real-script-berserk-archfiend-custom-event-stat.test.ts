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
const berserkCode = "13744068";
const ownFiendCode = "137440680";
const ownWarriorCode = "137440681";
const opponentA = "137440682";
const opponentB = "137440683";
const responderCode = "137440684";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBerserkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${berserkCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasBerserkScript)("Lua real script Berserk Archfiend custom event stat", () => {
  it("restores SelectUnselectGroup self summon into operated destroy count custom-event missed timing", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${berserkCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const berserk = requireCard(session, berserkCode);
    const fiend = requireCard(session, ownFiendCode);
    const warrior = requireCard(session, ownWarriorCode);
    const oppA = requireCard(session, opponentA);
    const oppB = requireCard(session, opponentB);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, berserk.uid, "hand", 0);
    moveFaceUpAttack(session, fiend, 0);
    moveFaceUpAttack(session, warrior, 0);
    moveFaceUpAttack(session, oppA, 1);
    moveFaceUpAttack(session, oppB, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(berserkCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === berserk.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: berserk.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [fiend.fieldId],
        targetUids: [fiend.uid],
        operationInfos: [
          { category: 0x200, targetUids: [berserk.uid], count: 1, player: 0, parameter: 0x2 },
          { category: 0x1, targetUids: [fiend.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("berserk responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === berserk.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: berserk.uid,
      reasonEffectId: 1,
    });
    for (const destroyed of [fiend]) {
      expect(restoredChain.session.state.cards.find((card) => card.uid === destroyed.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: berserk.uid,
        reasonEffectId: 1,
      });
    }

    const restoredAfterMissedCustom = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterMissedCustom);
    expectRestoredLegalActions(restoredAfterMissedCustom, 0);
    expect(restoredAfterMissedCustom.session.state.pendingTriggers).toHaveLength(1);
    expect(getLuaRestoreLegalActions(restoredAfterMissedCustom, 0).some((action) => action.type === "activateTrigger" && action.uid === berserk.uid)).toBe(true);
    expect(currentAttack(restoredAfterMissedCustom.session.state.cards.find((card) => card.uid === berserk.uid), restoredAfterMissedCustom.session.state)).toBe(2000);
    expect(restoredAfterMissedCustom.session.state.eventHistory.filter((event) => ["specialSummoned", "destroyed", "customEvent", "chainSolved"].includes(event.eventName))).toEqual([
      specialSummonedEvent(berserk.uid),
      destroyedEvent(fiend.uid, berserk.uid),
      {
        eventName: "customEvent",
        eventCode: 0x10000000 + Number(berserkCode),
        eventCardUid: berserk.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: berserk.uid,
        eventReasonEffectId: 1,
        relatedEffectId: 1,
        eventUids: [berserk.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
      chainSolvedEvent(1, "chain-2"),
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_DESTROY)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,2,s.rescon,0)");
  expect(script).toContain("Duel.SetTargetCard(dg)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,LOCATION_HAND)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,dg,#dg,tp,0)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("local og=Duel.GetOperatedGroup()");
  expect(script).toContain("Duel.RaiseSingleEvent(c,EVENT_CUSTOM+id,e,REASON_EFFECT,tp,tp,#og)");
  expect(script).toContain("e2:SetCode(EVENT_CUSTOM+id)");
  expect(script).toContain("Duel.SelectTarget(tp,s.cfilter,tp,0,LOCATION_MZONE,ev,ev,nil)");
  expect(script).toContain("local atk=g:GetSum(Card.GetBaseAttack)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === berserkCode),
    { code: ownFiendCode, name: "Berserk Own Fiend", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 900, defense: 1000 },
    { code: ownWarriorCode, name: "Berserk Own Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1100, defense: 1000 },
    { code: opponentA, name: "Berserk Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentB, name: "Berserk Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: responderCode, name: "Berserk Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 13744068, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [berserkCode, ownFiendCode, ownWarriorCode] }, 1: { main: [opponentA, opponentB, responderCode] } });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      const loaded = workspace.readScript(name);
      if (loaded === undefined) throw new Error(`Missing script ${name}`);
      return loaded;
    },
  };
  return { session, reader, source };
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
      e:SetOperation(function(e,tp) Debug.Message("berserk responder resolved") end)
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

function specialSummonedEvent(cardUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 1,
    eventUids: [cardUid],
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
  };
}

function destroyedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: cardUid === `p0-deck-${ownFiendCode}-1` ? 0 : 2 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: cardUid === `p0-deck-${ownFiendCode}-1` ? 0 : 1 },
  };
}

function chainSolvedEvent(effectId: number, linkId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventReasonPlayer: 0,
    eventValue: 1,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: linkId,
  };
}
