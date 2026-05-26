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
const crimsonFoxCode = "94919024";
const sendSpellCode = "949190240";
const lunalightAllyCode = "949190241";
const opponentTargetCode = "949190242";
const targetingSpellCode = "949190243";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrimsonFoxScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crimsonFoxCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceBeastWarrior = 0x4000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setLunalight = 0xdf;
const effectSetAttackFinal = 102;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasCrimsonFoxScript)("Lua real script Lunalight Crimson Fox grave stat negate recover", () => {
  it("restores sent-to-Graveyard ATK 0 targeting and Graveyard self-banish activation negation recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${crimsonFoxCode}.lua`));
    const reader = createCardReader(cards());

    const restoredTrigger = createRestoredSentToGraveTrigger({ reader, workspace });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const fox = requireCard(restoredTrigger.session, crimsonFoxCode);
    const ally = requireCard(restoredTrigger.session, lunalightAllyCode);
    const opponentTarget = requireCard(restoredTrigger.session, opponentTargetCode);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        sourceUid: fox.uid,
        effectId: "lua-1-1014",
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        triggerBucket: "turnOptional",
        eventCode: eventToGrave,
        eventTriggerTiming: "if",
        eventCardUid: fox.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: requireCard(restoredTrigger.session, sendSpellCode).uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === fox.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 1107169792 }, sourceUid: opponentTarget.uid, value: 0 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: fox.uid,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: eventToGrave,
        eventCardUid: fox.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: requireCard(restoredTrigger.session, sendSpellCode).uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: eventToGrave,
        eventCardUid: requireCard(restoredTrigger.session, sendSpellCode).uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: opponentTarget.uid,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), sentToGraveSource(workspace), reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    restoredStat.session.state.phase = "battle";
    restoredStat.session.state.turnPlayer = 0;
    restoredStat.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ally.uid && action.targetUid === opponentTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, attack!);
    passRestoredBattle(restoredStat);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 1800 });

    const restoredResponse = createRestoredTargetingResponse({ reader, workspace });
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const responseFox = requireCard(restoredResponse.session, crimsonFoxCode);
    const targetingSpell = requireCard(restoredResponse.session, targetingSpellCode);
    const responseAlly = requireCard(restoredResponse.session, lunalightAllyCode);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === responseFox.uid && action.effectId === "lua-2-1027");
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    passRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("crimson fox targeting spell resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === responseFox.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: responseFox.uid,
      reasonEffectId: 2,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === targetingSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: responseFox.uid,
      reasonEffectId: 2,
    });
    expect(restoredResponse.session.state.players[0]?.lifePoints).toBe(9000);
    expect(restoredResponse.session.state.players[1]?.lifePoints).toBe(9000);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["becameTarget", "banished", "sentToGraveyard", "chainNegated", "chainDisabled", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: responseAlly.uid,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: responseFox.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: responseFox.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: eventToGrave,
        eventCardUid: targetingSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: responseFox.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: responseFox.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: responseFox.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
    ]);
  });
});

function createRestoredSentToGraveTrigger({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 94919024, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [crimsonFoxCode, sendSpellCode, lunalightAllyCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, crimsonFoxCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, sendSpellCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, lunalightAllyCode), 0);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const source = sentToGraveSource(workspace);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crimsonFoxCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(sendSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const send = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === requireCard(restoredOpen.session, sendSpellCode).uid);
  expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, send!);
  passRestoredChain(restoredOpen);
  return restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
}

function createRestoredTargetingResponse({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 94919025, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [crimsonFoxCode, lunalightAllyCode] }, 1: { main: [targetingSpellCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, crimsonFoxCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, lunalightAllyCode), 0);
  moveDuelCard(session.state, requireCard(session, targetingSpellCode).uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const source = targetingSource(workspace);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crimsonFoxCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(targetingSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 1);
  const targeting = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === requireCard(restoredOpen.session, targetingSpellCode).uid);
  expect(targeting, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, targeting!);
  return restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsReason(REASON_EFFECT)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetCategory(CATEGORY_NEGATE+CATEGORY_RECOVER)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("and Duel.IsChainNegatable(ev)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.SendtoGrave(eg,REASON_EFFECT)");
  expect(script).toContain("Duel.Recover(tp,1000,REASON_EFFECT)");
  expect(script).toContain("Duel.Recover(1-tp,1000,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: crimsonFoxCode, name: "Lunalight Crimson Fox", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 600, setcodes: [setLunalight] },
    { code: sendSpellCode, name: "Lunalight Crimson Fox Send Spell", kind: "spell", typeFlags: typeSpell },
    { code: lunalightAllyCode, name: "Lunalight Crimson Fox Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000, setcodes: [setLunalight] },
    { code: opponentTargetCode, name: "Lunalight Crimson Fox Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2200, defense: 1000 },
    { code: targetingSpellCode, name: "Lunalight Crimson Fox Targeting Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function sentToGraveSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${sendSpellCode}.lua`) return sendFoxScript();
      return workspace.readScript(name);
    },
  };
}

function targetingSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${targetingSpellCode}.lua`) return targetingSpellScript();
      return workspace.readScript(name);
    },
  };
}

function sendFoxScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_TOGRAVE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_HAND,0,1,nil,${crimsonFoxCode}) end
        local g=Duel.SelectMatchingCard(tp,Card.IsCode,tp,LOCATION_HAND,0,1,1,nil,${crimsonFoxCode})
        Duel.SetTargetCard(g)
        Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then
          Duel.SendtoGrave(tc,REASON_EFFECT)
        end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function targetingSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_ATKCHANGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(1-tp) and chkc:IsCode(${lunalightAllyCode}) end
        if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${lunalightAllyCode}) end
        Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${lunalightAllyCode})
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("crimson fox targeting spell resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
