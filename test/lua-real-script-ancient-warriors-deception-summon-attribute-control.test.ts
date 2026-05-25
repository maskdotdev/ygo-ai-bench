import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttribute } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const deceptionCode = "45115956";
const summonTargetCode = "451159560";
const offSetHandCode = "451159561";
const ownTargetCode = "451159562";
const opponentTargetCode = "451159563";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDeceptionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${deceptionCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const setAncientWarriors = 0x137;
const raceBeastWarrior = 0x400000;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const attributeWind = 0x10;
const attributeDark = 0x20;
const effectChangeAttribute = 127;
const categorySpecialSummon = 0x200;
const categoryDamage = 0x80000;
const categoryControl = 0x2000;
const effectFlagCardTarget = 16;

describe.skipIf(!hasUpstreamScripts || !hasDeceptionScript)("Lua real script Ancient Warriors Deception summon attribute control", () => {
  it("restores SZone Ancient Warriors summon-burn and self-to-Grave attribute-control branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${deceptionCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const summonOpen = createRestoredSzoneOpen({ reader, workspace, mode: "summon" });
    const summonDeception = requireCard(summonOpen.session, deceptionCode);
    const summonTarget = requireCard(summonOpen.session, summonTargetCode);
    const offSetHand = requireCard(summonOpen.session, offSetHandCode);
    expectCleanRestore(summonOpen);
    expectRestoredLegalActions(summonOpen, 0);
    expect(summonOpen.session.state.effects.filter((effect) => effect.sourceUid === summonDeception.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 1002, countLimit: undefined, event: "ignition", property: undefined, range: ["hand", "spellTrapZone"] },
      { category: categorySpecialSummon | categoryDamage, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["spellTrapZone"] },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["spellTrapZone"] },
    ]);
    const summon = getLuaRestoreLegalActions(summonOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonDeception.uid && action.effectId === "lua-2"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(summonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summonOpen, summon!);
    passRestoredChain(summonOpen);
    expect(summonOpen.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonDeception.uid,
      reasonEffectId: 2,
    });
    expect(summonOpen.session.state.cards.find((card) => card.uid === offSetHand.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(summonOpen.session.state.players[0].lifePoints).toBe(7600);
    expect(summonOpen.session.state.eventHistory.filter((event) => ["specialSummoned", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonTarget.uid,
        eventUids: [summonTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonDeception.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 400,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonDeception.uid,
        eventReasonEffectId: 2,
      },
    ]);

    const controlOpen = createRestoredSzoneOpen({ reader, workspace, mode: "control" }, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    const controlDeception = requireCard(controlOpen.session, deceptionCode);
    const opponentTarget = requireCard(controlOpen.session, opponentTargetCode);
    expectCleanRestore(controlOpen);
    expectRestoredLegalActions(controlOpen, 0);
    const control = getLuaRestoreLegalActions(controlOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === controlDeception.uid && action.effectId === "lua-3"
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(controlOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(controlOpen, control!);
    passRestoredChain(controlOpen);
    expect(controlOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 721855298, returned: true },
    ]);
    expect(controlOpen.session.state.cards.find((card) => card.uid === controlDeception.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: controlDeception.uid,
      reasonEffectId: 3,
    });
    expect(controlOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: controlDeception.uid,
      reasonEffectId: 3,
    });
    expect(currentAttribute(controlOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid)!, controlOpen.session.state)).toBe(attributeEarth);
    expect(controlOpen.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid && effect.code === effectChangeAttribute).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeAttribute, reset: { flags: 33427456 }, sourceUid: opponentTarget.uid, value: attributeEarth },
    ]);
    expect(controlOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: controlDeception.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: controlDeception.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: opponentTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: opponentTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: controlDeception.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(controlOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Ancient Warriors Saga - Deception and Betrayal");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_DAMAGE)");
  expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.Damage(tp,tc:GetLevel()*100,REASON_EFFECT)");
  expect(script).toContain("e3:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_ANCIENT_WARRIORS),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("local att=tc:AnnounceAnotherAttribute(tp)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_ATTRIBUTE)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.GetControl(tc,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: deceptionCode, name: "Ancient Warriors Saga - Deception and Betrayal", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setAncientWarriors] },
    { code: summonTargetCode, name: "Ancient Warriors Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, setcodes: [setAncientWarriors], level: 4, attack: 1600, defense: 1000 },
    { code: offSetHandCode, name: "Non-Ancient Warriors Hand Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
    { code: ownTargetCode, name: "Ancient Warriors Own Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, setcodes: [setAncientWarriors], level: 4, attack: 1500, defense: 1000 },
    { code: opponentTargetCode, name: "Ancient Warriors Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, setcodes: [setAncientWarriors], level: 4, attack: 1700, defense: 1000 },
  ];
}

function createRestoredSzoneOpen(
  {
    mode,
    reader,
    workspace,
  }: {
    mode: "summon" | "control";
    reader: ReturnType<typeof createCardReader>;
    workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  },
  restoreOptions?: Parameters<typeof restoreDuelWithLuaScripts>[3],
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const main = mode === "summon"
    ? [deceptionCode, summonTargetCode, offSetHandCode]
    : [deceptionCode];
  const opponentMain = mode === "control" ? [opponentTargetCode] : [];
  const session = createDuel({ seed: 45115956, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: opponentMain } });
  startDuel(session);
  const deception = requireCard(session, deceptionCode);
  moveDuelCard(session.state, deception.uid, "spellTrapZone", 0).faceUp = true;
  if (mode === "summon") {
    moveDuelCard(session.state, requireCard(session, summonTargetCode).uid, "hand", 0);
    moveDuelCard(session.state, requireCard(session, offSetHandCode).uid, "hand", 0);
  } else {
    moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(deceptionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, restoreOptions);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
