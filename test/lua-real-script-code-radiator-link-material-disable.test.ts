import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const codeRadiatorCode = "75130221";
const fieldCyberseCode = "751302210";
const codeTalkerLinkCode = "751302211";
const targetACode = "751302212";
const targetBCode = "751302213";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const setCodeTalker = 0x101;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Code Radiator Link material disable", () => {
  it("restores its Code Talker Link material trigger into two targeted ATK 0 disables", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${codeRadiatorCode}.lua`);
    expectScriptShape(script);

    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const codeRadiatorData = databaseCards.find((card) => card.code === codeRadiatorCode);
    expect(codeRadiatorData).toBeDefined();
    const cards: DuelCardData[] = [
      codeRadiatorData!,
      { code: fieldCyberseCode, name: "Code Radiator Cyberse Link Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, level: 4, attack: 1000, defense: 1000 },
      { code: codeTalkerLinkCode, name: "Code Radiator Code Talker Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, level: 2, attack: 1800, defense: 0, setcodes: [setCodeTalker], linkMaterialRace: raceCyberse, linkMaterialMin: 2, linkMaterialMax: 2 },
      { code: targetACode, name: "Code Radiator Disable Target A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
      { code: targetBCode, name: "Code Radiator Disable Target B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2100, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 75130221, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [codeRadiatorCode, fieldCyberseCode], extra: [codeTalkerLinkCode] }, 1: { main: [targetACode, targetBCode] } });
    startDuel(session);

    const codeRadiator = requireCard(session, codeRadiatorCode);
    const fieldCyberse = requireCard(session, fieldCyberseCode);
    const codeTalker = requireCard(session, codeTalkerLinkCode);
    const targetA = requireCard(session, targetACode);
    const targetB = requireCard(session, targetBCode);
    moveFaceUpAttack(session, codeRadiator, 0);
    moveFaceUpAttack(session, fieldCyberse, 0);
    moveFaceUpAttack(session, targetA, 1);
    moveFaceUpAttack(session, targetB, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(codeRadiatorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.some((effect) => effect.code === 358 && effect.sourceUid === codeRadiator.uid)).toBe(true);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const linkSummon = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "linkSummon" && action.uid === codeTalker.uid && sameMembers(action.materialUids, [codeRadiator.uid, fieldCyberse.uid]),
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, linkSummon!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === codeRadiator.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.material | duelReason.link,
      reasonCardUid: codeTalker.uid,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial" && event.eventCardUid === codeRadiator.uid)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: codeRadiator.uid,
        eventReason: duelReason.link,
        eventReasonCardUid: codeTalker.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-1108",
        eventCardUid: codeRadiator.uid,
        eventCode: eventBeMaterial,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.link,
        eventReasonCardUid: codeTalker.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: codeRadiator.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === codeRadiator.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    for (const targetUid of [targetA.uid, targetB.uid]) {
      const target = restoredTrigger.session.state.cards.find((card) => card.uid === targetUid);
      expect(target).toBeDefined();
      expect(currentAttack(target!, restoredTrigger.session.state)).toBe(0);
      expect(isCardDisabled(restoredTrigger.session.state, target!, (effect, sourceCard, targetCard) =>
        createEffectContext(restoredTrigger.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
      )).toBe(true);
    }
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_MATERIAL)");
  expect(script).toContain("e1:SetOperation(s.extracon)");
  expect(script).toContain("e1:SetValue(s.extraval)");
  expect(script).toContain("return (sg+mg):Filter(s.extrafilter,nil,e:GetHandlerPlayer()):IsExists(Card.IsRace,1,og,RACE_CYBERSE) and");
  expect(script).toContain("sg:FilterCount(s.flagcheck,nil)<2");
  expect(script).toContain("summon_type~=SUMMON_TYPE_LINK or not sc:IsSetCard(SET_CODE_TALKER)");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and c:IsPreviousLocation(LOCATION_ONFIELD|LOCATION_HAND) and r==REASON_LINK and c:GetReasonCard():IsSetCard(SET_CODE_TALKER)");
  expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,0,LOCATION_MZONE,1,1+e:GetLabel(),nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");
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

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}
