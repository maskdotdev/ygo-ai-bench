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
const spiderCode = "82041999";
const trapCode = "820419990";
const monsterDecoyCode = "820419991";
const targeterCode = "820419992";
const opponentTargetCode = "820419993";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSpiderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiderCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const racePsychic = 0x100000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setPunk = 0x173;
const effectSetAttackFinal = 102;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSpiderScript)("Lua real script Joruri-P.U.N.K. Madame Spider LP search target halve stat", () => {
  it("restores LP-cost P.U.N.K. Trap search and target-response ATK halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectSpiderScriptShape(workspace.readScript(`official/c${spiderCode}.lua`));
    const spiderData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === spiderCode);
    expect(spiderData).toBeDefined();
    const reader = createCardReader([
      spiderData!,
      ...fixtureCards(),
    ]);

    const restoredSearch = createRestoredSearchWindow({ reader, workspace });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchSpider = requireCard(restoredSearch.session, spiderCode);
    const trap = requireCard(restoredSearch.session, trapCode);
    const monsterDecoy = requireCard(restoredSearch.session, monsterDecoyCode);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateEffect" && action.uid === searchSpider.uid && action.effectId === "lua-1");
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    resolveRestoredChain(restoredSearch);
    expect(restoredSearch.session.state.players[0].lifePoints).toBe(7400);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === trap.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchSpider.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === monsterDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["lifePointCostPaid", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 600,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: searchSpider.uid,
        eventReasonEffectId: 1,
      },
      sentToHandEvent(trap.uid, searchSpider.uid, 1, 2),
      confirmedEvent(trap.uid, searchSpider.uid, 1, 2),
      sentToHandConfirmedEvent(trap.uid, searchSpider.uid, 1, 2),
      chainSolvedEvent(1, "chain-3", 0),
    ]);
    expect(restoredSearch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const source = sourceWithTargeter(workspace);
    const restoredTarget = createRestoredTargetWindow({ reader, source, workspace });
    expectCleanRestore(restoredTarget);
    expectRestoredLegalActions(restoredTarget, 0);
    const targetSpider = requireCard(restoredTarget.session, spiderCode);
    const targeter = requireCard(restoredTarget.session, targeterCode);
    const opponentTarget = requireCard(restoredTarget.session, opponentTargetCode);
    const targetAction = getLuaRestoreLegalActions(restoredTarget, 0).find((action) => action.type === "activateEffect" && action.uid === targeter.uid);
    expect(targetAction, JSON.stringify(getLuaRestoreLegalActions(restoredTarget, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTarget, targetAction!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredTarget.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const halve = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === targetSpider.uid && action.effectId === "lua-2-1028");
    expect(halve, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, halve!);
    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).toContain("madame spider targeter resolved");
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredResponse.session.state)).toBe(1000);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentTarget.uid, value: 1000 },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["becameTarget", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentTarget.uid, eventChainDepth: 1, eventChainLinkId: "chain-2", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 3 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentTarget.uid, eventChainDepth: 2, eventChainLinkId: "chain-3", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 2 },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventChainDepth: 2, eventChainLinkId: "chain-3", eventReason: undefined, eventReasonPlayer: 0, relatedEffectId: 2 },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventChainDepth: 1, eventChainLinkId: "chain-2", eventReason: undefined, eventReasonPlayer: 0, relatedEffectId: 3 },
    ]);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSearchWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82041999, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [spiderCode, trapCode, monsterDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, spiderCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spiderCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredTargetWindow({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82042000, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [spiderCode, targeterCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, spiderCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, targeterCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spiderCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(targeterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function sourceWithTargeter(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${targeterCode}.lua`) return targeterScript();
      return workspace.readScript(name);
    },
  };
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: trapCode, name: "Madame Spider P.U.N.K. Trap", kind: "trap", typeFlags: typeTrap, setcodes: [setPunk] },
    { code: monsterDecoyCode, name: "Madame Spider P.U.N.K. Monster Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPunk], race: racePsychic, attribute: attributeEarth, level: 3, attack: 1200, defense: 600 },
    { code: targeterCode, name: "Madame Spider P.U.N.K. Targeter", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPunk], race: racePsychic, attribute: attributeEarth, level: 3, attack: 1000, defense: 600 },
    { code: opponentTargetCode, name: "Madame Spider Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
  ];
}

function targeterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(s.tg)
      e:SetOperation(s.op)
      c:RegisterEffect(e)
    end
    function s.tg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(1-tp) and chkc:IsFaceup() and chkc:IsLocation(LOCATION_MZONE) end
      if chk==0 then return Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_FACEUP)
      Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)
    end
    function s.op(e,tp,eg,ep,ev,re,r,rp)
      Debug.Message("madame spider targeter resolved")
    end
  `;
}

function expectSpiderScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Joruri-P.U.N.K. Madame Spider");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetCost(Cost.PayLP(600))");
  expect(script).toContain("return c:IsSetCard(SET_PUNK) and c:IsTrap() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e2:SetCode(EVENT_BECOME_TARGET)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return rp==tp and re:GetHandler():IsSetCard(SET_PUNK) and eg:IsExists(s.atkconfilter,1,nil,tp)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
}

function sentToHandEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function chainSolvedEvent(effectId: number, chainLinkId: string, player: PlayerId) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: player,
    eventValue: 1,
    eventReasonPlayer: player,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainLinkId,
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    passRestoredChain(restored, player);
  }
}
