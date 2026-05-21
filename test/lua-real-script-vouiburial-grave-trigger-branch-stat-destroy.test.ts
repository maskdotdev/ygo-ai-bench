import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, createDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const vouiburialCode = "36974120";
const opponentSentCode = "369741200";
const opponentEffectCode = "369741201";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasVouiburialScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vouiburialCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasVouiburialScript)("Lua real script Vouiburial grave trigger branch stat destroy", () => {
  it("restores hand EVENT_TO_GRAVE branch into once-per-turn self Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vouiburialCode}.lua`);
    expectScriptShape(script);

    const { session, reader } = createSession(workspace);
    const vouiburial = requireCard(session, vouiburialCode);
    const opponentSent = requireCard(session, opponentSentCode);
    moveDuelCard(session.state, vouiburial.uid, "hand", 0);
    moveFaceUpAttack(session, opponentSent, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vouiburialCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, opponentSent.uid, 1, duelReason.effect | duelReason.destroy, 0, "graveyard", { eventReasonCardUid: opponentSent.uid, eventReasonEffectId: 99 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === vouiburial.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(trigger).toMatchObject({ type: "activateTrigger", uid: vouiburial.uid, windowKind: "triggerBucket", triggerBucket: "turnOptional" });
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === vouiburial.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: vouiburial.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.flagEffects.filter((flag) => flag.code === Number(vouiburialCode))).toEqual([
      { code: Number(vouiburialCode), ownerId: "0", ownerType: "player", property: 0, reset: 0x40000200, resetCount: 1, turn: 1, value: 0 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      destroyedEvent(opponentSent.uid, opponentSent.uid, 99),
      sentToGraveyardEvent(opponentSent.uid, opponentSent.uid, 99),
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: vouiburial.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: vouiburial.uid,
        eventReasonEffectId: 2,
        eventUids: [vouiburial.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });

  it("restores field EVENT_TO_GRAVE branch into ATK loss, AdjustInstantly, SelectYesNo, and destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vouiburialCode}.lua`);
    expectScriptShape(script);

    const { session, reader } = createSession(workspace);
    const vouiburial = requireCard(session, vouiburialCode);
    const opponentSent = requireCard(session, opponentSentCode);
    const opponentEffect = requireCard(session, opponentEffectCode);
    moveFaceUpAttack(session, vouiburial, 0);
    moveFaceUpAttack(session, opponentSent, 1);
    moveFaceUpAttack(session, opponentEffect, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vouiburialCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === vouiburial.uid && effect.code === 42)).toMatchObject({
      code: 42,
      event: "continuous",
      range: ["monsterZone"],
      targetRange: [4, 4],
    });
    destroyDuelCard(session.state, opponentSent.uid, 1, duelReason.effect | duelReason.destroy, 0, "graveyard", { eventReasonCardUid: opponentSent.uid, eventReasonEffectId: 99 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === vouiburial.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 591585921, returned: true },
    ]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentEffect.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: vouiburial.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.flagEffects.filter((flag) => flag.code === Number(vouiburialCode) + 1)).toEqual([
      { code: Number(vouiburialCode) + 1, ownerId: "0", ownerType: "player", property: 0, reset: 0x40000200, resetCount: 1, turn: 1, value: 0 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["breakEffect", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentSent.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: opponentSent.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: vouiburial.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentEffect.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: vouiburial.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e1:SetTarget(s.indestg)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return Duel.IsMainPhase() and eg:IsExists(s.effconfilter,1,nil,tp)");
  expect(script).toContain("Duel.HasFlagEffect(tp,id)");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id+1,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,nil,1,1-tp,LOCATION_MZONE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.IsType,TYPE_EFFECT),tp,0,LOCATION_MZONE,1,1,nil):GetFirst()");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1500)");
  expect(script).toContain("Duel.AdjustInstantly(tc)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vouiburialCode),
    { code: opponentSentCode, name: "Vouiburial Opponent Sent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentEffectCode, name: "Vouiburial Opponent Effect Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 36974120, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [vouiburialCode] }, 1: { main: [opponentSentCode, opponentEffectCode] } });
  startDuel(session);
  return { session, reader };
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

function destroyedEvent(uid: string, reasonCardUid: string, reasonEffectId: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: uid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function sentToGraveyardEvent(uid: string, reasonCardUid: string, reasonEffectId: number) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: uid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: reasonCardUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}
