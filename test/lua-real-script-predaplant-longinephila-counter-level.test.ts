import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
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
const longinephilaCode = "44994712";
const targetCode = "449947120";
const predapSearchCode = "449947121";
const polymerizationCode = "24094653";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLonginephilaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${longinephilaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const racePlant = 0x400;
const attributeDark = 0x20;
const setPredap = 0x10f3;
const counterPredator = 0x1041;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLonginephilaScript)("Lua real script Predaplant Longinephila counter level", () => {
  it("restores grave SelfBanish SelectEffect into Predator Counter placement and Level 1 lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${longinephilaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restored = createRestoredGraveState(reader, workspace);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const longinephila = requireCard(restored.session, longinephilaCode);
    const target = requireCard(restored.session, targetCode);
    const ignition = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === longinephila.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, ignition!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, longinephila.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: longinephila.uid,
      reasonEffectId: 3,
    });
    expect(getDuelCardCounter(findCard(restored.session, target.uid), counterPredator)).toBe(1);
    expect(currentLevel(findCard(restored.session, target.uid), restored.session.state)).toBe(1);
    expect(restored.host.promptDecisions).toContainEqual({
      id: "lua-prompt-1",
      api: "SelectEffect",
      player: 0,
      options: [1, 2],
      descriptions: [719915394, 719915395],
      returned: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "banished", eventCardUid: longinephila.uid, eventReason: duelReason.cost, eventReasonCardUid: longinephila.uid, eventReasonEffectId: 3 },
      { eventName: "counterAdded", eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonCardUid: longinephila.uid, eventReasonEffectId: 3 },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const polymerization = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === polymerizationCode);
  expect(polymerization).toBeDefined();
  return [
    { code: longinephilaCode, name: "Predaplant Longinephila", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, setcodes: [setPredap], level: 4, attack: 1900, defense: 0 },
    polymerization!,
    { code: targetCode, name: "Longinephila Predator Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: predapSearchCode, name: "Longinephila Predap Search Card", kind: "spell", typeFlags: typeSpell, setcodes: [setPredap] },
  ];
}

function createRestoredGraveState(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 44994712, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [longinephilaCode, targetCode, predapSearchCode, polymerizationCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, longinephilaCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, predapSearchCode).uid, "deck", 0);
  const polymerization = moveDuelCard(session.state, requireCard(session, polymerizationCode).uid, "graveyard", 0);
  polymerization.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerLonginephila(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerLonginephila(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 1 }] });
  expect(host.loadCardScript(Number(longinephilaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Predaplant Longinephila");
  expect(script).toContain("e1a:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1a:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e1b:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,tp,COUNTER_PREDATOR)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_LEAVE_GRAVE,nil,1,tp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.predctfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.HintSelection(tc)");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.polysetfilter),tp,LOCATION_GRAVE|LOCATION_REMOVED,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,sg)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
