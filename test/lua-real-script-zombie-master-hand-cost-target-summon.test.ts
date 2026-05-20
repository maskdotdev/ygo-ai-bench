import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const zombieMasterCode = "17259470";
const hasZombieMasterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zombieMasterCode}.lua`));
const costCode = "17259471";
const reviveCode = "17259472";
const opponentReviveCode = "17259473";
const levelFiveDecoyCode = "17259474";
const warriorDecoyCode = "17259475";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasZombieMasterScript)("Lua real script Zombie Master hand cost target revive", () => {
  it("restores hand monster cost into either-Graveyard Level 4 Zombie targeted Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${zombieMasterCode}.lua`);
    expect(script).toContain('e1:SetDescription(aux.Stringid(id,0))');
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsMonster() and c:IsAbleToGraveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("return c:IsLevelBelow(4) and c:IsRace(RACE_ZOMBIE) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_GRAVE,LOCATION_GRAVE,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,LOCATION_GRAVE,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("if c:IsFaceup() and c:IsRelateToEffect(e) and tc:IsRelateToEffect(e) and tc:IsRace(RACE_ZOMBIE) then");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: zombieMasterCode, name: "Zombie Master", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1800, defense: 0 },
      { code: costCode, name: "Hand Cost Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 3, attack: 900, defense: 900 },
      { code: reviveCode, name: "Own Grave Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
      { code: opponentReviveCode, name: "Opponent Grave Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1500, defense: 1200 },
      { code: levelFiveDecoyCode, name: "Level Five Zombie Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 5, attack: 1800, defense: 1500 },
      { code: warriorDecoyCode, name: "Warrior Grave Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1100 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 17259470, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zombieMasterCode, costCode, reviveCode, levelFiveDecoyCode, warriorDecoyCode] }, 1: { main: [opponentReviveCode] } });
    startDuel(session);

    const zombieMaster = requireCard(session, zombieMasterCode);
    const cost = requireCard(session, costCode);
    const revive = requireCard(session, reviveCode);
    const opponentRevive = requireCard(session, opponentReviveCode);
    const levelFiveDecoy = requireCard(session, levelFiveDecoyCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    moveDuelCard(session.state, zombieMaster.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, cost.uid, "hand", 0);
    moveDuelCard(session.state, revive.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentRevive.uid, "graveyard", 1);
    moveDuelCard(session.state, levelFiveDecoy.uid, "graveyard", 0);
    moveDuelCard(session.state, warriorDecoy.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zombieMasterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === zombieMaster.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonCardUid: zombieMaster.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: zombieMaster.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentRevive.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === levelFiveDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: zombieMaster.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 3 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: revive.uid,
        eventUids: [revive.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: zombieMaster.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
