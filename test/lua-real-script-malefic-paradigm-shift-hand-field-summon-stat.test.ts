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
const paradigmCode = "5125629";
const maleficWorldCode = "27564031";
const existingFieldCode = "51256290";
const maleficSummonCode = "51256291";
const opponentHighCode = "51256292";
const opponentLowCode = "51256293";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasParadigmScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${paradigmCode}.lua`));
const setMalefic = 0x23;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeField = 0x80000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasParadigmScript)("Lua real script Malefic Paradigm Shift hand field summon stat", () => {
  it("restores hand Trap LP cost into Field Zone placement, Malefic summon, and opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${paradigmCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 5125629, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [paradigmCode, existingFieldCode, maleficWorldCode, maleficSummonCode] },
      1: { main: [opponentHighCode, opponentLowCode] },
    });
    startDuel(session);

    const paradigm = requireCard(session, paradigmCode);
    const existingField = requireCard(session, existingFieldCode);
    const maleficWorld = requireCard(session, maleficWorldCode);
    const maleficSummon = requireCard(session, maleficSummonCode);
    const opponentHigh = requireCard(session, opponentHighCode);
    const opponentLow = requireCard(session, opponentLowCode);
    moveDuelCard(session.state, paradigm.uid, "hand", 0);
    moveFaceUpSpell(session, existingField, 0, 0);
    moveFaceUpAttack(session, opponentHigh, 1, 0);
    moveFaceUpAttack(session, opponentLow, 1, 1);
    session.state.players[0].lifePoints = 8000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(paradigmCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectOption", player: 0, returned: 1 }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activateParadigm = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === paradigm.uid
    );
    expect(activateParadigm, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activateParadigm!);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(4000);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid").map((event) => ({
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCode: 1201, eventName: "lifePointCostPaid", eventPlayer: 0, eventReason: duelReason.cost, eventReasonCardUid: paradigm.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventValue: 4000 },
    ]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption")).toEqual([
      { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1], descriptions: [573, 82010067], returned: 1 },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === existingField.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === maleficWorld.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: paradigm.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === maleficSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: paradigm.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentHigh.uid), restoredOpen.session.state)).toBe(500);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentLow.uid), restoredOpen.session.state)).toBe(100);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentHigh.uid)).toMatchObject({ attackModifier: -2500 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentLow.uid)).toMatchObject({ attackModifier: -2500 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "moved", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: existingField.uid, eventCode: 1030, eventName: "moved", eventReason: duelReason.rule, eventReasonCardUid: paradigm.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: existingField.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: paradigm.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: maleficWorld.uid, eventCode: 1030, eventName: "moved", eventReason: duelReason.effect, eventReasonCardUid: paradigm.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: maleficSummon.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: paradigm.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: paradigm.uid, eventCode: 1030, eventName: "moved", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: paradigm.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Malefic Paradigm Shift");
  expect(script).toContain("EFFECT_TRAP_ACT_IN_HAND");
  expect(script).toContain("Duel.PayLPCost(tp,Duel.GetLP(tp)//2)");
  expect(script).toContain("CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_TYPE_ACTIVATE");
  expect(script).toContain("EFFECT_COUNT_CODE_OATH");
  expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,nil,c)>0");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,Duel.GetFieldGroup(tp,0,LOCATION_MZONE),1,tp,-2500)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.maleficworldfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("aux.ToHandOrElse(sc,tp,");
  expect(script).toContain("Duel.GetFieldCard(tp,LOCATION_FZONE,0)");
  expect(script).toContain("Duel.SendtoGrave(fc,REASON_RULE)");
  expect(script).toContain("Duel.MoveToField(sc,tp,tp,LOCATION_FZONE,POS_FACEUP,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,true,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("aux.FaceupFilter(Card.IsAttackAbove,2500)");
  expect(script).toContain("tc:UpdateAttack(-2500,RESETS_STANDARD_PHASE_END,c)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const paradigm = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === paradigmCode);
  const maleficWorld = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === maleficWorldCode);
  expect(paradigm).toBeDefined();
  expect(maleficWorld).toBeDefined();
  return [
    { ...paradigm!, kind: "trap", typeFlags: typeTrap },
    { ...maleficWorld!, kind: "spell", typeFlags: typeSpell | typeField },
    { code: existingFieldCode, name: "Existing Field Spell Fixture", kind: "spell", typeFlags: typeSpell | typeField, attack: 0, defense: 0 },
    { code: maleficSummonCode, name: "Malefic Summon Target Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 8, attack: 2800, defense: 2500, setcodes: [setMalefic] },
    { code: opponentHighCode, name: "Paradigm High ATK Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 3000, defense: 1000 },
    { code: opponentLowCode, name: "Paradigm Other Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
