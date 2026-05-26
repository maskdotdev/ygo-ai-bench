import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { LuaPromptOverride } from "#lua/host-types.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dancerCode = "81196066";
const perfumeCode = "48444114";
const bounceSpellCode = "811960660";
const handSummonCode = "811960661";
const opponentHighDefenseCode = "811960662";
const opponentLowDefenseCode = "811960663";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDancerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dancerCode}.lua`));
const setLunalight = 0xdf;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceBeastWarrior = 0x4000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const summonTypeFusion = 0x43000000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDancerScript)("Lua real script Lunalight Perfume Dancer fusion search bounce stat", () => {
  it("restores Fusion Summon search, field bounce into optional hand Special Summon, and grave ATK reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dancerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredFusion = createRestoredDancerField({ reader, workspace, dancerLocation: "extraDeck" });
    expectCleanRestore(restoredFusion);
    expectRestoredLegalActions(restoredFusion, 0);
    const fusionDancer = requireCard(restoredFusion.session, dancerCode);
    const perfume = requireCard(restoredFusion.session, perfumeCode);
    specialSummonDuelCard(restoredFusion.session.state, fusionDancer.uid, 0, 0, {}, summonTypeFusion, true, false);
    expect(restoredFusion.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1102", eventCardUid: fusionDancer.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: fusionDancer.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredFusion.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fusionDancer.uid
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchTrigger!);
    resolveRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === perfume.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fusionDancer.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${perfumeCode}`);
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: fusionDancer.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: perfume.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: fusionDancer.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: perfume.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: fusionDancer.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: perfume.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: fusionDancer.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);

    const restoredBounce = createRestoredDancerField({
      reader,
      workspace,
      dancerLocation: "monsterZone",
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredBounce);
    expectRestoredLegalActions(restoredBounce, 0);
    const fieldDancer = requireCard(restoredBounce.session, dancerCode);
    const bounceSpell = requireCard(restoredBounce.session, bounceSpellCode);
    const handSummon = requireCard(restoredBounce.session, handSummonCode);
    const bounceAction = getLuaRestoreLegalActions(restoredBounce, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldDancer.uid
    );
    expect(bounceAction, JSON.stringify(getLuaRestoreLegalActions(restoredBounce, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBounce, bounceAction!);
    resolveRestoredChain(restoredBounce);

    expect(restoredBounce.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
    ]);
    expect(restoredBounce.session.state.cards.find((card) => card.uid === bounceSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldDancer.uid,
      reasonEffectId: 3,
    });
    expect(restoredBounce.session.state.cards.find((card) => card.uid === handSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fieldDancer.uid,
      reasonEffectId: 3,
    });
    expect(restoredBounce.session.state.eventHistory.filter((event) => ["becameTarget", "sentToHand", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: bounceSpell.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 3 },
      { eventCardUid: bounceSpell.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: fieldDancer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: handSummon.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: fieldDancer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);

    const restoredGrave = createRestoredDancerField({ reader, workspace, dancerLocation: "graveyard" });
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const graveDancer = requireCard(restoredGrave.session, dancerCode);
    const highDefenseOpponent = requireCard(restoredGrave.session, opponentHighDefenseCode);
    const lowDefenseOpponent = requireCard(restoredGrave.session, opponentLowDefenseCode);
    const graveAction = getLuaRestoreLegalActions(restoredGrave, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveDancer.uid
    );
    expect(graveAction, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, graveAction!);
    resolveRestoredChain(restoredGrave);

    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveDancer.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveDancer.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredGrave.session.state.cards.find((card) => card.uid === highDefenseOpponent.uid), restoredGrave.session.state)).toBe(1300);
    expect(currentAttack(restoredGrave.session.state.cards.find((card) => card.uid === lowDefenseOpponent.uid), restoredGrave.session.state)).toBe(1500);
    expect(restoredGrave.session.state.effects.filter((effect) => effect.sourceUid === graveDancer.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1073742336 }, sourceUid: graveDancer.uid, targetRange: [0, 4], value: undefined },
    ]);
    expect(restoredGrave.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: graveDancer.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: graveDancer.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
    expect(restoredGrave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredDancerField({
  reader,
  workspace,
  dancerLocation,
  promptOverrides,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  dancerLocation: "extraDeck" | "monsterZone" | "graveyard";
  promptOverrides?: LuaPromptOverride[];
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 81196066 + dancerLocation.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [perfumeCode, bounceSpellCode, handSummonCode], extra: [dancerCode] },
    1: { main: [opponentHighDefenseCode, opponentLowDefenseCode] },
  });
  startDuel(session);
  const dancer = requireCard(session, dancerCode);
  if (dancerLocation === "monsterZone") moveFaceUpAttack(session, dancer, 0, 0);
  if (dancerLocation === "graveyard") moveFaceUpGrave(session, dancer, 0, 0);
  if (dancerLocation === "monsterZone") {
    moveFaceUpSpellTrap(session, requireCard(session, bounceSpellCode), 0, 0);
    moveDuelCard(session.state, requireCard(session, handSummonCode).uid, "hand", 0);
  }
  if (dancerLocation === "graveyard") {
    moveFaceUpAttack(session, requireCard(session, opponentHighDefenseCode), 1, 0);
    moveFaceUpAttack(session, requireCard(session, opponentLowDefenseCode), 1, 1);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dancerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, promptOverrides ? { promptOverrides } : {});
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Lunalight Perfume Dancer");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_LUNALIGHT),2)");
  expect(script).toContain("CATEGORY_TOHAND+CATEGORY_SEARCH");
  expect(script).toContain("EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O");
  expect(script).toContain("EVENT_SPSUMMON_SUCCESS");
  expect(script).toContain("e1:SetCondition(function(e) return e:GetHandler():IsFusionSummoned() end)");
  expect(script).toContain("return c:IsCode(48444114) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,tp,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("CATEGORY_TOHAND+CATEGORY_SPECIAL_SUMMON");
  expect(script).toContain("EFFECT_TYPE_IGNITION");
  expect(script).toContain("EFFECT_FLAG_CARD_TARGET");
  expect(script).toContain("return c:IsSetCard(SET_LUNALIGHT) and c:IsFaceup() and (c:IsAbleToHand() or c:IsAbleToExtra())");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,3))");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("aux.RegisterClientHint(c,0,tp,0,1,aux.Stringid(id,4))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTargetRange(0,LOCATION_MZONE)");
  expect(script).toContain("e1:SetValue(function(e,c) return -c:GetBaseDefense() end)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dancer = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dancerCode);
  const perfume = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === perfumeCode);
  expect(dancer).toBeDefined();
  expect(perfume).toBeDefined();
  return [
    { ...dancer!, kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeastWarrior, attribute: attributeDark, setcodes: [setLunalight] },
    { ...perfume!, kind: "spell", typeFlags: typeSpell },
    { code: bounceSpellCode, name: "Lunalight Perfume Dancer Bounce Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setLunalight] },
    { code: handSummonCode, name: "Lunalight Perfume Dancer Hand Summon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 800, setcodes: [setLunalight] },
    { code: opponentHighDefenseCode, name: "Perfume Dancer High DEF Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2500, defense: 1200 },
    { code: opponentLowDefenseCode, name: "Perfume Dancer Low DEF Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2000, defense: 500 },
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.faceUp = true;
  moved.position = "faceDown";
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
