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
const honestNeosCode = "14124483";
const heroTargetCode = "141244830";
const heroDiscardCode = "141244831";
const nonHeroCode = "141244832";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHonestNeosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${honestNeosCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setHero = 0x8;
const effectFlagCannotDisable = 0x400;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 0x41fe1200;
const resetStandardDisablePhaseEnd = 0x41ff1200;

describe.skipIf(!hasUpstreamScripts || !hasHonestNeosScript)("Lua real script Elemental HERO Honest Neos hand field HERO attack", () => {
  it("restores hand SelfDiscard HERO target boost and field HERO discard self boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${honestNeosCode}.lua`));
    const reader = createCardReader(cards());

    const handBoost = createHandBoost({ reader, workspace });
    expectCleanRestore(handBoost.restored);
    expectRestoredLegalActions(handBoost.restored, 0);
    expect(handBoost.restored.session.state.effects.filter((effect) => effect.sourceUid === handBoost.honestNeos.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: 1002, countLimit: 1, event: "quick", property: 16400, range: ["hand"], sourceUid: handBoost.honestNeos.uid },
      { category: 2097152, code: 1002, countLimit: 1, event: "quick", property: 16384, range: ["monsterZone"], sourceUid: handBoost.honestNeos.uid },
    ]);
    const handAction = getLuaRestoreLegalActions(handBoost.restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === handBoost.honestNeos.uid && candidate.effectId === "lua-1-1002",
    );
    expect(handAction, JSON.stringify(getLuaRestoreLegalActions(handBoost.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(handBoost.restored, handAction!);
    resolveRestoredChain(handBoost.restored);

    expect(handBoost.restored.session.state.cards.find((card) => card.uid === handBoost.honestNeos.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handBoost.honestNeos.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(handBoost.restored.session.state.cards.find((card) => card.uid === handBoost.heroTarget.uid), handBoost.restored.session.state)).toBe(4100);
    expect(handBoost.restored.session.state.effects.filter((effect) => effect.sourceUid === handBoost.heroTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: handBoost.heroTarget.uid, value: 2500 },
    ]);
    expect(handBoost.restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handBoost.honestNeos.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: handBoost.honestNeos.uid, eventReasonEffectId: 1 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: handBoost.heroTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const fieldBoost = createFieldBoost({ reader, workspace });
    expectCleanRestore(fieldBoost.restored);
    expectRestoredLegalActions(fieldBoost.restored, 0);
    const fieldAction = getLuaRestoreLegalActions(fieldBoost.restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === fieldBoost.honestNeos.uid && candidate.effectId === "lua-2-1002",
    );
    expect(fieldAction, JSON.stringify(getLuaRestoreLegalActions(fieldBoost.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(fieldBoost.restored, fieldAction!);
    resolveRestoredChain(fieldBoost.restored);

    expect(fieldBoost.restored.session.state.cards.find((card) => card.uid === fieldBoost.heroDiscard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: fieldBoost.honestNeos.uid,
      reasonEffectId: 2,
    });
    expect(fieldBoost.restored.session.state.cards.find((card) => card.uid === fieldBoost.nonHero.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(currentAttack(fieldBoost.restored.session.state.cards.find((card) => card.uid === fieldBoost.honestNeos.uid), fieldBoost.restored.session.state)).toBe(4300);
    expect(fieldBoost.restored.session.state.effects.filter((effect) => effect.sourceUid === fieldBoost.honestNeos.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: fieldBoost.honestNeos.uid, value: 1800 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(fieldBoost.restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === fieldBoost.honestNeos.uid), restoredAfter.session.state)).toBe(4300);
  });
});

function createHandBoost({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): { honestNeos: DuelCardInstance; heroTarget: DuelCardInstance; restored: ReturnType<typeof restoreDuelWithLuaScripts> } {
  const session = createDuel({ seed: 14124483, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [honestNeosCode, heroTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const honestNeos = requireCard(session, honestNeosCode);
  const heroTarget = requireCard(session, heroTargetCode);
  moveDuelCard(session.state, honestNeos.uid, "hand", 0);
  moveFaceUpAttack(session, heroTarget, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(honestNeosCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { honestNeos, heroTarget, restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader) };
}

function createFieldBoost({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): { honestNeos: DuelCardInstance; heroDiscard: DuelCardInstance; nonHero: DuelCardInstance; restored: ReturnType<typeof restoreDuelWithLuaScripts> } {
  const session = createDuel({ seed: 14124484, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [honestNeosCode, heroDiscardCode, nonHeroCode] }, 1: { main: [] } });
  startDuel(session);
  const honestNeos = requireCard(session, honestNeosCode);
  const heroDiscard = requireCard(session, heroDiscardCode);
  const nonHero = requireCard(session, nonHeroCode);
  moveFaceUpAttack(session, honestNeos, 0, 0);
  moveDuelCard(session.state, heroDiscard.uid, "hand", 0);
  moveDuelCard(session.state, nonHero.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(honestNeosCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { honestNeos, heroDiscard, nonHero, restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader) };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Elemental HERO Honest Neos");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_HERO),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetValue(2500)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.selfatkcostfilter,tp,LOCATION_HAND,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SendtoGrave(sc,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: honestNeosCode, name: "Elemental HERO Honest Neos", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 7, attack: 2500, defense: 2000, setcodes: [setHero] },
    { code: heroTargetCode, name: "Honest Neos HERO Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000, setcodes: [setHero] },
    { code: heroDiscardCode, name: "Honest Neos HERO Discard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000, setcodes: [setHero] },
    { code: nonHeroCode, name: "Honest Neos Non-HERO Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
