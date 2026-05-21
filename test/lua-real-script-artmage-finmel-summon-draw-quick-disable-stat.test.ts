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
const finmelCode = "34541940";
const faceupArtmageCode = "345419400";
const ownRaceProbeCode = "345419401";
const drawCardCode = "345419402";
const opponentAcode = "345419403";
const opponentBcode = "345419404";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFinmelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${finmelCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setArtmage = 0x1c7;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const raceDragon = 0x2000;
const raceMachine = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasFinmelScript)("Lua real script Artmage Finmel summon draw quick disable stat", () => {
  it("restores hand Special Summon optional draw into main-phase opponent monster negate and final ATK halve", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${finmelCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 34541940, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [finmelCode, faceupArtmageCode, ownRaceProbeCode, drawCardCode] },
      1: { main: [opponentAcode, opponentBcode] },
    });
    startDuel(session);

    const finmel = requireCard(session, finmelCode);
    const faceupArtmage = requireCard(session, faceupArtmageCode);
    const ownRaceProbe = requireCard(session, ownRaceProbeCode);
    const drawCard = requireCard(session, drawCardCode);
    const opponentA = requireCard(session, opponentAcode);
    const opponentB = requireCard(session, opponentBcode);
    moveDuelCard(session.state, finmel.uid, "hand", 0);
    moveFaceUpAttack(session, faceupArtmage, 0);
    moveFaceUpAttack(session, ownRaceProbe, 0);
    moveFaceUpAttack(session, opponentA, 1);
    moveFaceUpAttack(session, opponentB, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(finmelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === finmel.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 71, event: "continuous", range: ["monsterZone"], targetRange: [4, 0], value: undefined },
      { code: undefined, event: "ignition", range: ["hand"], targetRange: undefined, value: undefined },
      { code: 1002, event: "quick", range: ["monsterZone"], targetRange: undefined, value: undefined },
    ]);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === finmel.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 552671042, returned: true },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === finmel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: finmel.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["specialSummoned", "breakEffect", "cardsDrawn"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: finmel.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: finmel.uid, eventReasonEffectId: 2 },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: finmel.uid, eventReasonEffectId: 2 },
      { eventName: "cardsDrawn", eventCode: 1110, eventCardUid: drawCard.uid, eventPlayer: 0, eventValue: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: finmel.uid, eventReasonEffectId: 2 },
    ]);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, 0);
    const quick = getLuaRestoreLegalActions(restoredSummoned, 0).find((action) => action.type === "activateEffect" && action.uid === finmel.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredSummoned, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummoned, quick!);
    expect(restoredSummoned.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredSummoned);

    expect(currentAttack(restoredSummoned.session.state.cards.find((card) => card.uid === opponentA.uid), restoredSummoned.session.state)).toBe(1000);
    expect(currentAttack(restoredSummoned.session.state.cards.find((card) => card.uid === opponentB.uid), restoredSummoned.session.state)).toBe(600);
    expect(restoredSummoned.session.state.effects.filter((effect) => [opponentA.uid, opponentB.uid].includes(effect.sourceUid ?? "") && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107169792 }, sourceUid: opponentA.uid, value: 1000 },
      { code: 102, reset: { flags: 1107169792 }, sourceUid: opponentB.uid, value: 600 },
    ]);
    expect(restoredSummoned.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("return c:IsLevelBelow(6) and c:IsSetCard(SET_ARTMAGE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_DRAW)");
  expect(script).toContain("e2:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DRAW,nil,1,tp,1)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
  expect(script).toContain("e3:SetCategory(CATEGORY_DISABLE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil):GetBinClassCount(Card.GetRace)>=3");
  expect(script).toContain("if tc:IsNegatableMonster() then tc:NegateEffects(c) end");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
}

function cards(): DuelCardData[] {
  return [
    { code: finmelCode, name: "Artmage Finmel", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArtmage], race: raceDragon, level: 4, attack: 1800, defense: 1200 },
    { code: faceupArtmageCode, name: "Artmage Faceup Probe", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArtmage], race: raceWarrior, level: 4, attack: 1500, defense: 1000 },
    { code: ownRaceProbeCode, name: "Artmage Race Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, level: 4, attack: 1400, defense: 1000 },
    { code: drawCardCode, name: "Artmage Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: opponentAcode, name: "Artmage Opponent Negate A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 2000, defense: 1000 },
    { code: opponentBcode, name: "Artmage Opponent Negate B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 4, attack: 1200, defense: 1000 },
  ];
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
