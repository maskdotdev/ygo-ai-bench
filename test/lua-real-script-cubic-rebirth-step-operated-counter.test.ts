import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const cubicRebirthCode = "71442223";
const attackerCode = "714422230";
const cubicMonsterCode = "714422231";
const blockerACode = "714422232";
const blockerBCode = "714422233";
const blockerCCode = "714422234";
const setCubic = 0xe3;
const cubicCounter = 0x1038;
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cubic Rebirth SpecialSummonStep operated counters", () => {
  it("restores attack-announce Trap activation into opponent SpecialSummonStep operated-group counters and Cubic hand summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cubicRebirthCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.SetTargetCard(bc)");
    expect(script).toContain("Duel.SpecialSummonStep(sc,0,opp,opp,false,false,POS_FACEUP_ATTACK)");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(script).toContain("local og=Duel.GetOperatedGroup()");
    expect(script).toContain("tc:AddCounter(COUNTER_CUBIC,1)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cubicRebirthCode),
      { code: attackerCode, name: "Cubic Rebirth Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: cubicMonsterCode, name: "Cubic Rebirth Cubic Summon", kind: "monster", typeFlags: typeMonster, setcodes: [setCubic], level: 4, attack: 1000, defense: 1000 },
      { code: blockerACode, name: "Cubic Rebirth Zone Blocker A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 100, defense: 100 },
      { code: blockerBCode, name: "Cubic Rebirth Zone Blocker B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 100, defense: 100 },
      { code: blockerCCode, name: "Cubic Rebirth Zone Blocker C", kind: "monster", typeFlags: typeMonster, level: 4, attack: 100, defense: 100 },
      { code: attackerCode, name: "Cubic Rebirth Duplicate Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 71442223, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [cubicRebirthCode, cubicMonsterCode] },
      1: { main: [attackerCode, blockerACode, blockerBCode, blockerCCode, attackerCode] },
    });
    startDuel(session);

    const cubicRebirth = requireCard(session, cubicRebirthCode, 0, 0);
    const cubicMonster = requireCard(session, cubicMonsterCode, 0, 0);
    const attacker = requireCard(session, attackerCode, 1, 0);
    const duplicate = requireCard(session, attackerCode, 1, 1);
    const blockerA = requireCard(session, blockerACode, 1, 0);
    const blockerB = requireCard(session, blockerBCode, 1, 0);
    const blockerC = requireCard(session, blockerCCode, 1, 0);
    moveDuelCard(session.state, cubicRebirth.uid, "spellTrapZone", 0);
    cubicRebirth.faceUp = false;
    cubicRebirth.position = "faceDown";
    moveDuelCard(session.state, cubicMonster.uid, "hand", 0);
    moveFaceUpAttack(session, attacker.uid, 1);
    moveFaceUpAttack(session, blockerA.uid, 1);
    moveFaceUpAttack(session, blockerB.uid, 1);
    moveFaceUpAttack(session, blockerC.uid, 1);
    moveDuelCard(session.state, duplicate.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cubicRebirthCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.directAttack);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const trapActivation = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateEffect" && action.uid === cubicRebirth.uid);
    expect(trapActivation, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, trapActivation!);

    expect(restoredAttack.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredAttack.session.state.chain).toEqual([]);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === duplicate.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: cubicRebirth.uid,
      reasonEffectId: 1,
    });
    expect(restoredAttack.session.state.cards.find((card) => card.uid === cubicMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: cubicRebirth.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === attacker.uid), restoredAttack.session.state)).toBe(0);
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === duplicate.uid), restoredAttack.session.state)).toBe(0);
    expect(getDuelCardCounter(restoredAttack.session.state.cards.find((card) => card.uid === attacker.uid), cubicCounter)).toBe(1);
    expect(getDuelCardCounter(restoredAttack.session.state.cards.find((card) => card.uid === duplicate.uid), cubicCounter)).toBe(1);
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventUids?.includes(duplicate.uid))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: duplicate.uid,
        eventUids: [duplicate.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: cubicRebirth.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 4 },
      },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && [attacker.uid, duplicate.uid].includes(event.eventCardUid ?? ""))).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: attacker.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cubicRebirth.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: duplicate.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 4 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cubicRebirth.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredAttack.session.state.effects.filter((effect) => [attacker.uid, duplicate.uid].includes(effect.sourceUid ?? "")).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
    }))).toEqual([
      { sourceUid: attacker.uid, code: 102, event: "continuous", reset: { flags: 33427456 } },
      { sourceUid: attacker.uid, code: 85, event: "continuous", reset: { flags: 33427456 } },
      { sourceUid: attacker.uid, code: 2, event: "continuous", reset: { flags: 33427456 } },
      { sourceUid: duplicate.uid, code: 102, event: "continuous", reset: { flags: 33427456 } },
      { sourceUid: duplicate.uid, code: 85, event: "continuous", reset: { flags: 33427456 } },
      { sourceUid: duplicate.uid, code: 2, event: "continuous", reset: { flags: 33427456 } },
    ]);
  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  return card;
}

function requireCard(session: DuelSession, code: string, owner: PlayerId, index: number): DuelCardInstance {
  const cards = session.state.cards.filter((candidate) => candidate.code === code && candidate.owner === owner);
  expect(cards[index]).toBeDefined();
  return cards[index]!;
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
