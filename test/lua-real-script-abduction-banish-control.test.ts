import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const abductionCode = "21846145";
const targetCode = "218461450";
const matchingBanishCode = "218461451";
const nonmatchingBanishCode = "218461452";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAbductionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abductionCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const categoryRemove = 0x4;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasAbductionScript)("Lua real script Abduction banish control", () => {
  it("restores targeted opponent control after matching Deck or Extra Deck banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${abductionCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 21846145, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [abductionCode, matchingBanishCode, nonmatchingBanishCode] },
      1: { main: [targetCode] },
    });
    startDuel(session);

    const abduction = requireCard(session, abductionCode);
    const target = requireCard(session, targetCode);
    const matchingBanish = requireCard(session, matchingBanishCode);
    const nonmatchingBanish = requireCard(session, nonmatchingBanishCode);
    moveDuelCard(session.state, abduction.uid, "hand", 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(abductionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === abduction.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryRemove | categoryControl, code: eventFreeChain, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["hand", "spellTrapZone"] },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === abduction.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === matchingBanish.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: abduction.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === nonmatchingBanish.uid)).toMatchObject({
      location: "deck",
      controller: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: abduction.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "banished", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: matchingBanish.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: abduction.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "banished" },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: abduction.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "monsterZone" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Abduction");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter,tp,0,LOCATION_MZONE,1,1,nil,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil,tc:GetOriginalRace(),tc:GetOriginalAttribute(),tc,original_lvrklnk)");
  expect(script).toContain("Duel.Remove(rc,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("tc:NegateEffects(e:GetHandler(),RESET_CONTROL)");
}

function cards(): DuelCardData[] {
  return [
    { code: abductionCode, name: "Abduction", kind: "spell", typeFlags: typeSpell },
    { code: targetCode, name: "Abduction Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: matchingBanishCode, name: "Abduction Matching Banish", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: nonmatchingBanishCode, name: "Abduction Nonmatching Banish", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
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
  const waitingFor = restored.session.state.waitingFor;
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
