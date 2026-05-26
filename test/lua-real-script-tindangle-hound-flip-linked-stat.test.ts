import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const houndCode = "31759689";
const turnSetTargetCode = "317596890";
const battleTargetCode = "317596891";
const linkedTargetCode = "317596892";
const linkedPartnerCode = "317596893";
const gravePositionTargetCode = "317596894";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHoundScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${houndCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFlip = 0x200000;
const typeLink = 0x4000000;
const raceFiend = 0x8;
const attributeDark = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasHoundScript)("Lua real script Tindangle Hound flip linked stat", () => {
  it("restores linked ATK drop, flip ATK gain turn-set, destroyed position trigger, and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${houndCode}.lua`));
    const reader = createCardReader(cards());

    const linkedSession = createDuel({ seed: 31759689, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(linkedSession, { 0: { main: [houndCode] }, 1: { main: [linkedTargetCode, linkedPartnerCode] } });
    startDuel(linkedSession);
    const linkedHound = requireCard(linkedSession, houndCode);
    const linkedTarget = requireCard(linkedSession, linkedTargetCode);
    const linkedPartner = requireCard(linkedSession, linkedPartnerCode);
    moveFaceUpAttack(linkedSession, linkedHound, 0, 0);
    moveFaceUpAttack(linkedSession, linkedTarget, 1, 1);
    moveFaceUpAttack(linkedSession, linkedPartner, 1, 2);
    linkedSession.state.phase = "main1";
    linkedSession.state.turnPlayer = 0;
    linkedSession.state.waitingFor = 0;

    const linkedHost = createLuaScriptHost(linkedSession, workspace);
    expect(linkedHost.loadCardScript(Number(houndCode), workspace).ok).toBe(true);
    expect(linkedHost.registerInitialEffects()).toBe(1);
    expect(currentAttack(linkedTarget, linkedSession.state)).toBe(1000);
    expect(currentAttack(linkedPartner, linkedSession.state)).toBe(500);

    const restoredLinked = restoreDuelWithLuaScripts(serializeDuel(linkedSession), workspace, reader);
    expectCleanRestore(restoredLinked);
    expectRestoredLegalActions(restoredLinked, 0);
    expect(currentAttack(restoredLinked.session.state.cards.find((card) => card.uid === linkedTarget.uid), restoredLinked.session.state)).toBe(1000);
    expect(currentAttack(restoredLinked.session.state.cards.find((card) => card.uid === linkedPartner.uid), restoredLinked.session.state)).toBe(500);
    expect(restoredLinked.session.state.effects.filter((effect) => effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      luaTypeFlags: effect.luaTypeFlags,
      value: effect.value,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      {
        code: 100,
        event: "continuous",
        range: ["monsterZone"],
        sourceUid: linkedHound.uid,
        targetRange: [0, 4],
        luaTypeFlags: 2,
        value: undefined,
        luaTargetDescriptor: undefined,
        luaValueDescriptor: undefined,
      },
    ]);

    const flipSession = createDuel({ seed: 31759690, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(flipSession, { 0: { main: [houndCode] }, 1: { main: [turnSetTargetCode, battleTargetCode] } });
    startDuel(flipSession);
    const flipHound = requireCard(flipSession, houndCode);
    const turnSetTarget = requireCard(flipSession, turnSetTargetCode);
    const battleTarget = requireCard(flipSession, battleTargetCode);
    moveFaceDownDefense(flipSession, flipHound, 0, 0);
    moveFaceUpAttack(flipSession, turnSetTarget, 1, 0);
    moveFaceUpAttack(flipSession, battleTarget, 1, 1);
    flipSession.state.phase = "main1";
    flipSession.state.turnPlayer = 0;
    flipSession.state.waitingFor = 0;

    const flipHost = createLuaScriptHost(flipSession, workspace);
    expect(flipHost.loadCardScript(Number(houndCode), workspace).ok).toBe(true);
    expect(flipHost.registerInitialEffects()).toBe(1);

    const restoredFlipOpen = restoreDuelWithLuaScripts(serializeDuel(flipSession), workspace, reader);
    expectCleanRestore(restoredFlipOpen);
    expectRestoredLegalActions(restoredFlipOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredFlipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === flipHound.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredFlipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipOpen, flip!);

    const restoredFlipTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredFlipOpen.session), workspace, reader);
    expectCleanRestore(restoredFlipTrigger);
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    expect(restoredFlipTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1",
        eventCardUid: flipHound.uid,
        eventCode: 1001,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "flipSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: flipHound.uid,
        triggerBucket: "turnMandatory",
      },
    ]);
    const flipTrigger = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === flipHound.uid);
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipTrigger, flipTrigger!);
    resolveRestoredChain(restoredFlipTrigger);
    expect(restoredFlipTrigger.session.state.cards.find((card) => card.uid === turnSetTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceDownDefense", faceUp: false });
    expect(currentAttack(restoredFlipTrigger.session.state.cards.find((card) => card.uid === flipHound.uid), restoredFlipTrigger.session.state)).toBe(4300);
    expect(restoredFlipTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "breakEffect", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: turnSetTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: flipHound.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: turnSetTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: flipHound.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredFlipTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === flipHound.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 3300 });

    const destroyedSession = createDuel({ seed: 31759691, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(destroyedSession, { 0: { main: [houndCode] }, 1: { main: [gravePositionTargetCode] } });
    startDuel(destroyedSession);
    const destroyedHound = requireCard(destroyedSession, houndCode);
    const gravePositionTarget = requireCard(destroyedSession, gravePositionTargetCode);
    moveFaceUpAttack(destroyedSession, destroyedHound, 0, 0);
    moveFaceDownDefense(destroyedSession, gravePositionTarget, 1, 0);
    destroyedSession.state.phase = "main1";
    destroyedSession.state.turnPlayer = 0;
    destroyedSession.state.waitingFor = 0;

    const destroyedHost = createLuaScriptHost(destroyedSession, workspace);
    expect(destroyedHost.loadCardScript(Number(houndCode), workspace).ok).toBe(true);
    expect(destroyedHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(destroyedSession.state, destroyedHound.uid, 0, duelReason.effect | duelReason.destroy, 0);

    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(destroyedSession), workspace, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    expect(restoredDestroyedTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1014",
        eventCardUid: destroyedHound.uid,
        eventCode: 1014,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: destroyedHound.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedHound.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyedTrigger, destroyedTrigger!);
    resolveRestoredChain(restoredDestroyedTrigger);
    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === gravePositionTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense", faceUp: true });
    expect(restoredDestroyedTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: gravePositionTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: gravePositionTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedHound.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_POSITION+CATEGORY_SET)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsCanTurnSet() and c:GetBaseAttack()>0");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,c,1,tp,tc:GetFirst():GetBaseAttack())");
  expect(script).toContain("if c:UpdateAttack(atk)==atk then");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetTargetRange(0,LOCATION_MZONE)");
  expect(script).toContain("local lg=Duel.GetMatchingGroup(s.valfilter,0,LOCATION_MZONE,LOCATION_MZONE,c,c)");
  expect(script).toContain("lg:Merge(c:GetLinkedGroup():Filter(Card.IsMonster,nil))");
  expect(script).toContain("return #lg*-1000");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
  expect(script).toContain("return c:IsFacedown() and c:IsCanChangePosition()");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: houndCode, name: "Tindangle Hound", kind: "monster", typeFlags: typeMonster | typeEffect | typeFlip, race: raceFiend, attribute: attributeDark, level: 7, attack: 2500, defense: 0 },
    { code: turnSetTargetCode, name: "Hound Turn Set Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
    { code: battleTargetCode, name: "Hound Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: linkedTargetCode, name: "Hound Opponent Linked Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, race: raceFiend, attribute: attributeDark, level: 2, attack: 2000, defense: 0, linkMarkers: 0x20 },
    { code: linkedPartnerCode, name: "Hound Opponent Linked Partner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: gravePositionTargetCode, name: "Hound Grave Position Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 1300 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = false;
  moved.position = "faceDownDefense";
  moved.sequence = sequence;
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
