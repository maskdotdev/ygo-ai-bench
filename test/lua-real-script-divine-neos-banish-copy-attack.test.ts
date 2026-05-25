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
const divineCode = "31111109";
const heroCostCode = "311111090";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDivineScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${divineCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setHero = 0x8;
const effectUpdateAttack = 100;
const eventPhaseEnd = 4608;
const resetEventStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDivineScript)("Lua real script Divine Neos banish copy attack", () => {
  it("restores HERO grave banish cost into copy-inherit ATK gain and copy reset helper", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${divineCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredOpenState({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const divine = requireCard(restored.session, divineCode);
    const heroCost = requireCard(restored.session, heroCostCode);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === divine.uid && action.effectId === "lua-3"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === heroCost.uid)).toMatchObject({
      location: "banished",
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: divine.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(findCard(restored.session, divine.uid), restored.session.state)).toBe(3000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === divine.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x2000, reset: { flags: resetEventStandardDisable }, sourceUid: divine.uid, value: 500 },
    ]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === divine.uid && effect.code === eventPhaseEnd).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: eventPhaseEnd, property: 263168, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: divine.uid },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCardUid: heroCost.uid, eventReason: duelReason.cost, eventReasonCardUid: divine.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const divine = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === divineCode);
  expect(divine).toBeDefined();
  return [
    divine!,
    { code: heroCostCode, name: "Divine Neos HERO Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, setcodes: [setHero], level: 4, attack: 1600, defense: 1000 },
  ];
}

function createRestoredOpenState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 31111109, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [heroCostCode], extra: [divineCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, divineCode), 0, 0);
  const cost = moveDuelCard(session.state, requireCard(session, heroCostCode).uid, "graveyard", 0);
  cost.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(divineCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Elemental HERO Divine Neos");
  expect(script).toContain("Fusion.AddProcMixRep(c,true,true,s.ffilter,2,2");
  expect(script).toContain("aux.FilterBoolFunctionEx(Card.IsSetCard,SET_NEOS)");
  expect(script).toContain("aux.FilterBoolFunctionEx(Card.IsSetCard,SET_NEO_SPACIAN)");
  expect(script).toContain("aux.FilterBoolFunctionEx(Card.IsSetCard,SET_HERO)");
  expect(script).toContain("return c:IsSetCard({SET_NEOS,SET_NEO_SPACIAN,SET_HERO}) and c:IsMonster()");
  expect(script).toContain("and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SetTargetParam(tc:GetOriginalCode())");
  expect(script).toContain("local code=Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("local cid=c:CopyEffect(code,RESETS_STANDARD_PHASE_END,1)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)");
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
