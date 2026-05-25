import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const kiwiCode = "82627406";
const targetCode = "826274060";
const offSetCode = "826274061";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasKiwiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kiwiCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeWind = 0x8;
const setMagicianGirl = 0x20a2;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const effectIndestructableEffect = 41;
const effectCannotBeEffectTarget = 71;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasKiwiScript)("Lua real script Kiwi Magician Girl self-discard stat protect", () => {
  it("restores hand SelfDiscard into Magician Girl ATK/DEF boosts and field Spellcaster protections", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kiwiCode}.lua`);
    expect(script).toContain("--Kiwi Magician Girl");
    expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_MAGICIAN_GIRL),tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.ctfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,LOCATION_MZONE|LOCATION_GRAVE,nil)");
    expect(script).toContain("local d=g:GetClassCount(Card.GetCode)*300");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e3:SetValue(aux.tgoval)");

    const kiwiData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === kiwiCode);
    expect(kiwiData).toBeDefined();
    const reader = createCardReader([
      kiwiData!,
      { code: targetCode, name: "Kiwi Fixture Magician Girl Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWind, level: 4, attack: 1200, defense: 1000, setcodes: [setMagicianGirl] },
      { code: offSetCode, name: "Kiwi Fixture Off-Set Spellcaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWind, level: 4, attack: 1600, defense: 1000 },
    ] satisfies DuelCardData[]);
    const session = createDuel({ seed: 82627406, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kiwiCode, kiwiCode, targetCode, offSetCode] }, 1: { main: [] } });
    startDuel(session);

    const [fieldKiwi, handKiwi] = requireCards(session, kiwiCode, 2);
    const target = requireCard(session, targetCode);
    const offSet = requireCard(session, offSetCode);
    moveFaceUpAttack(session, fieldKiwi, 0, 0);
    moveFaceUpAttack(session, target, 0, 1);
    moveFaceUpAttack(session, offSet, 0, 2);
    moveDuelCard(session.state, handKiwi.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kiwiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fieldKiwi.uid && [effectIndestructableEffect, effectCannotBeEffectTarget].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableEffect, event: "continuous", luaTargetDescriptor: "target:race:2", luaValueDescriptor: undefined, property: undefined, range: ["monsterZone"], targetRange: [4, 0], value: 1 },
      { code: effectCannotBeEffectTarget, event: "continuous", luaTargetDescriptor: "target:race:2", luaValueDescriptor: "cannot-be-effect-target:opponent", property: 128, range: ["monsterZone"], targetRange: [4, 0], value: undefined },
    ]);

    const quickEffect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === handKiwi.uid);
    expect(quickEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, quickEffect!);
    resolveRestoredChain(restoredOpen);

    for (const boostedUid of [fieldKiwi.uid, target.uid]) {
      const boosted = findCard(restoredOpen.session, boostedUid);
      expect(currentAttack(boosted, restoredOpen.session.state)).toBe((boosted.data.attack ?? 0) + 600);
      expect(currentDefense(boosted, restoredOpen.session.state)).toBe((boosted.data.defense ?? 0) + 600);
    }
    expect(currentAttack(findCard(restoredOpen.session, offSet.uid), restoredOpen.session.state)).toBe(1600);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === handKiwi.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handKiwi.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => [fieldKiwi.uid, target.uid].includes(effect.sourceUid) && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: fieldKiwi.uid, value: 600 },
      { code: effectUpdateDefense, reset: { flags: 1107169792 }, sourceUid: fieldKiwi.uid, value: 600 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 600 },
      { code: effectUpdateDefense, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 600 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "discarded" || event.eventName === "sentToGraveyard")).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: handKiwi.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: handKiwi.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: handKiwi.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: handKiwi.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string, count: number): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toHaveLength(count);
  return cards;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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
