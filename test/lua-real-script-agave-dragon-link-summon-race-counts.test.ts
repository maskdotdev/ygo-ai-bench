import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const agaveCode = "2411269";
const hasAgaveScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${agaveCode}.lua`));
const dragonCode = "24112690";
const dinosaurCode = "24112691";
const seaSerpentCode = "24112692";
const wyrmCode = "24112693";
const opponentACode = "24112694";
const opponentBCode = "24112695";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDragon = 0x2000;
const raceDinosaur = 0x10000;
const raceSeaSerpent = 0x40000;
const raceWyrm = 0x800000;
const summonTypeLink = 0x4c000000;

describe.skipIf(!hasUpstreamScripts || !hasAgaveScript)("Lua real script Agave Dragon Link Summon race counts", () => {
  it("restores Link Summon trigger race counts into damage, recovery, and field ATK updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${agaveCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,aux.NOT(aux.FilterBoolFunctionEx(Card.IsType,TYPE_TOKEN)),2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_RECOVER+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsRace,tp,LOCATION_GRAVE,LOCATION_GRAVE,nil,RACE_DRAGON|RACE_DINOSAUR|RACE_SEASERPENT|RACE_WYRM)");
    expect(script).toContain("Duel.Damage(1-tp,ct1*100,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(ct2*200)");
    expect(script).toContain("e2:SetValue(ct3*-300)");
    expect(script).toContain("Duel.Recover(tp,ct4*400,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: agaveCode, name: "Agave Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 4, attack: 3000, defense: 0, linkMarkers: 0x2b },
      { code: dragonCode, name: "Agave Dragon Grave Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 4, attack: 1000, defense: 1000 },
      { code: dinosaurCode, name: "Agave Dragon Grave Dinosaur", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, level: 4, attack: 1000, defense: 1000 },
      { code: seaSerpentCode, name: "Agave Dragon Grave Sea Serpent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, level: 4, attack: 1000, defense: 1000 },
      { code: wyrmCode, name: "Agave Dragon Grave Wyrm", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWyrm, level: 4, attack: 1000, defense: 1000 },
      { code: opponentACode, name: "Agave Dragon Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
      { code: opponentBCode, name: "Agave Dragon Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2411269, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragonCode, dinosaurCode, seaSerpentCode, wyrmCode], extra: [agaveCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const agave = requireCard(session, agaveCode);
    const dragon = requireCard(session, dragonCode);
    const dinosaur = requireCard(session, dinosaurCode);
    const seaSerpent = requireCard(session, seaSerpentCode);
    const wyrm = requireCard(session, wyrmCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    moveDuelCard(session.state, dragon.uid, "graveyard", 0);
    moveDuelCard(session.state, dinosaur.uid, "graveyard", 0);
    moveDuelCard(session.state, seaSerpent.uid, "graveyard", 0);
    moveDuelCard(session.state, wyrm.uid, "graveyard", 0);
    moveFaceUpAttack(session, opponentA.uid, 1);
    moveFaceUpAttack(session, opponentB.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(agaveCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, agave.uid, 0, 0, {}, summonTypeLink, true, true);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === agave.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "link",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: agave.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        player: 0,
        sourceUid: agave.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === agave.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in trigger! ? trigger.operationInfos : []) ?? []).toEqual([]);
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.players[0]!.lifePoints).toBe(8400);
    expect(restoredResolved.session.state.players[1]!.lifePoints).toBe(7900);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === agave.uid), restoredResolved.session.state)).toBe(3200);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentA.uid), restoredResolved.session.state)).toBe(1200);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentB.uid), restoredResolved.session.state)).toBe(700);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["damageDealt", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 100,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: agave.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 400,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: agave.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredResolved.host.messages).not.toContain("agave dragon restore failed");
  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, controller: PlayerId) {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
  return card;
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

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
