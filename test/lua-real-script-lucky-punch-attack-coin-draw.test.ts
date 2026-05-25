import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const luckyPunchCode = "36378044";
const ownTargetCode = "363780440";
const attackerCode = "363780441";
const drawACode = "363780442";
const drawBCode = "363780443";
const drawCCode = "363780444";
const hasLuckyPunchScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${luckyPunchCode}.lua`));
const typeMonster = 0x1;
const categoryDestroy = 0x1;
const categoryDraw = 0x10000;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLuckyPunchScript)("Lua real script Lucky Punch attack coin draw", () => {
  it("restores opponent attack announcement into three-head TossCoin draw 3", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${luckyPunchCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 159, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [luckyPunchCode, ownTargetCode, drawACode, drawBCode, drawCCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const luckyPunch = requireCard(session, luckyPunchCode);
    const ownTarget = requireCard(session, ownTargetCode);
    const attacker = requireCard(session, attackerCode);
    const drawCards = [requireCard(session, drawACode), requireCard(session, drawBCode), requireCard(session, drawCCode)];
    moveFaceUpSpellTrap(session, luckyPunch, 0, 0);
    moveFaceUpAttack(session, ownTarget, 0, 0);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(luckyPunchCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === ownTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: ownTarget.uid });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1130",
        sourceUid: luckyPunch.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === luckyPunch.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 1002, countLimit: undefined, event: "quick", range: ["spellTrapZone"], triggerEvent: undefined },
      { category: categoryDraw | categoryDestroy | categoryCoin, code: 1130, countLimit: 1, event: "trigger", range: ["spellTrapZone"], triggerEvent: "attackDeclared" },
      { category: undefined, code: 1029, countLimit: undefined, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "destroyed" },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === luckyPunch.uid && action.effectId === "lua-2-1130");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1, 1, 1]);
    for (const card of drawCards) {
      expect(restoredTrigger.session.state.cards.find((candidate) => candidate.uid === card.uid)).toMatchObject({ location: "hand", controller: 0 });
    }
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === luckyPunch.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(restoredTrigger.session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: ownTarget.uid });
    const drawnOrder = [drawCards[1]!, drawCards[0]!, drawCards[2]!];
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["coinTossed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: luckyPunch.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawnOrder[0]!.uid,
        eventUids: drawnOrder.map((card) => card.uid),
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: luckyPunch.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Lucky Punch");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DRAW+CATEGORY_DESTROY+CATEGORY_COIN)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
  expect(script).toContain("e2:SetCountLimit(1)");
  expect(script).toContain("local at=Duel.GetAttacker()");
  expect(script).toContain("return at and at:IsControler(1-tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("local r1,r2,r3=Duel.TossCoin(tp,3)");
  expect(script).toContain("if Duel.CountHeads(r1,r2,r3)==3 then");
  expect(script).toContain("Duel.Draw(tp,3,REASON_EFFECT)");
  expect(script).toContain("elseif Duel.CountTails(r1,r2,r3)==3 then");
  expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousPosition(POS_FACEUP)");
  expect(script).toContain("local lp=Duel.GetLP(tp)");
  expect(script).toContain("Duel.SetLP(tp,lp-6000)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const luckyPunch = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === luckyPunchCode);
  expect(luckyPunch).toBeDefined();
  return [
    luckyPunch!,
    { code: ownTargetCode, name: "Lucky Punch Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "Lucky Punch Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
    { code: drawACode, name: "Lucky Punch Draw A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 100, defense: 100 },
    { code: drawBCode, name: "Lucky Punch Draw B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 200, defense: 100 },
    { code: drawCCode, name: "Lucky Punch Draw C", kind: "monster", typeFlags: typeMonster, level: 4, attack: 300, defense: 100 },
  ];
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
