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
const unformedVoidCode = "38180759";
const materialACode = "381807590";
const materialBCode = "381807591";
const materialCCode = "381807592";
const opponentXyzACode = "381807593";
const opponentXyzBCode = "381807594";
const opponentNonXyzCode = "381807595";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasUnformedVoidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unformedVoidCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const resetStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasUnformedVoidScript)("Lua real script Unformed Void opponent main Xyz attack stat", () => {
  it("restores opponent-main quick detach into ATK/DEF gain from opponent face-up Xyz attack sum", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${unformedVoidCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredOpponentMain({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const unformedVoid = requireCard(restored.session, unformedVoidCode);
    const materialA = requireCard(restored.session, materialACode);
    const opponentXyzA = requireCard(restored.session, opponentXyzACode);
    const opponentXyzB = requireCard(restored.session, opponentXyzBCode);
    const opponentNonXyz = requireCard(restored.session, opponentNonXyzCode);

    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === unformedVoid.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: unformedVoid.uid },
      { category: 2097152, code: 1002, event: "quick", property: undefined, range: ["monsterZone"], sourceUid: unformedVoid.uid },
    ]);

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === unformedVoid.uid && action.effectId === "lua-2-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === unformedVoid.uid)?.overlayUids).toEqual([requireCard(restored.session, materialBCode).uid, requireCard(restored.session, materialCCode).uid]);
    expect(findCard(restored.session, materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: unformedVoid.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(findCard(restored.session, opponentXyzA.uid), restored.session.state)).toBe(1800);
    expect(currentAttack(findCard(restored.session, opponentXyzB.uid), restored.session.state)).toBe(2400);
    expect(currentAttack(findCard(restored.session, opponentNonXyz.uid), restored.session.state)).toBe(3000);
    expect(currentAttack(findCard(restored.session, unformedVoid.uid), restored.session.state)).toBe(4200);
    expect(currentDefense(findCard(restored.session, unformedVoid.uid), restored.session.state)).toBe(4200);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === unformedVoid.uid && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandardDisable }, sourceUid: unformedVoid.uid, value: 4200 },
      { code: effectUpdateDefense, property: undefined, reset: { flags: resetStandardDisable }, sourceUid: unformedVoid.uid, value: 4200 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial").map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "graveyard", eventCardUid: materialA.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: unformedVoid.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "overlay", relatedEffectId: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const unformedVoid = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === unformedVoidCode);
  expect(unformedVoid).toBeDefined();
  return [
    unformedVoid!,
    { code: materialACode, name: "Unformed Void Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Unformed Void Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: materialCCode, name: "Unformed Void Material C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentXyzACode, name: "Unformed Void Opponent Xyz A", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
    { code: opponentXyzBCode, name: "Unformed Void Opponent Xyz B", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1600 },
    { code: opponentNonXyzCode, name: "Unformed Void Opponent Non-Xyz", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
  ];
}

function createRestoredOpponentMain({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 38180759, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [materialACode, materialBCode, materialCCode], extra: [unformedVoidCode] },
    1: { main: [opponentNonXyzCode], extra: [opponentXyzACode, opponentXyzBCode] },
  });
  startDuel(session);
  const unformedVoid = requireCard(session, unformedVoidCode);
  const materialA = requireCard(session, materialACode);
  const materialB = requireCard(session, materialBCode);
  const materialC = requireCard(session, materialCCode);
  moveFaceUpAttack(session, unformedVoid, 0, 0);
  moveDuelCard(session.state, materialA.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
  moveDuelCard(session.state, materialB.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 1;
  moveDuelCard(session.state, materialC.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 2;
  unformedVoid.overlayUids.push(materialA.uid, materialB.uid, materialC.uid);
  moveFaceUpAttack(session, requireCard(session, opponentXyzACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentXyzBCode), 1, 1);
  moveFaceUpAttack(session, requireCard(session, opponentNonXyzCode), 1, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(unformedVoidCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Unformed Void");
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,3)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCountLimit(1)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp) and (Duel.IsMainPhase())");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_XYZ)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("local atk=g:GetSum(Card.GetAttack)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
