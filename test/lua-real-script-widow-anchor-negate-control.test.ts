import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const widowCode = "98338152";
const targetCode = "983381520";
const graveSpell1Code = "983381521";
const graveSpell2Code = "983381522";
const graveSpell3Code = "983381523";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWidowScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${widowCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const typeEffect = 0x20;
const categoryControl = 0x4000;
const effectFlagCardTarget = 0x10;
const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasWidowScript)("Lua real script Widow Anchor negate control", () => {
  it("restores no-main-monster activation into target negation, SelectYesNo, BreakEffect, and temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${widowCode}.lua`);
    expect(script).toContain("--Sky Striker Mecha - Widow Anchor");
    expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return not Duel.IsExistingMatchingCard(Card.IsInMainMZone,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_EFFECT) and not c:IsDisabled()");
    expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsSpell,tp,LOCATION_GRAVE,0,nil)>=3");
    expect(script).toContain("tc:NegateEffects(c,RESET_PHASE|PHASE_END)");
    expect(script).toContain("Duel.AdjustInstantly(tc)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 98338152, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [widowCode, graveSpell1Code, graveSpell2Code, graveSpell3Code] }, 1: { main: [targetCode] } });
    startDuel(session);

    const widow = requireCard(session, widowCode);
    const target = requireCard(session, targetCode);
    const graveSpell1 = requireCard(session, graveSpell1Code);
    const graveSpell2 = requireCard(session, graveSpell2Code);
    const graveSpell3 = requireCard(session, graveSpell3Code);
    moveDuelCard(session.state, widow.uid, "hand", 0);
    moveDuelCard(session.state, graveSpell1.uid, "graveyard", 0);
    moveDuelCard(session.state, graveSpell2.uid, "graveyard", 0);
    moveDuelCard(session.state, graveSpell3.uid, "graveyard", 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(widowCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === widow.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      {
        category: categoryControl,
        code: 1002,
        event: "quick",
        property: effectFlagCardTarget,
        range: ["hand", "spellTrapZone"],
      },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === widow.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1573410433, returned: true },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? 0);
    passRestoredChain(restoredChain);

    expect(restoredChain.host.promptDecisions).toEqual([]);
    const controlledTarget = findCard(restoredChain.session, target.uid);
    expect(controlledTarget).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: widow.uid,
      reasonEffectId: 1,
    });
    expect(isCardDisabled(restoredChain.session.state, controlledTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.cards.find((card) => card.uid === widow.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 1, currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: widow.uid, eventReasonEffectId: 1, previousController: 1, currentController: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: widowCode, name: "Sky Striker Mecha - Widow Anchor", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: targetCode, name: "Widow Anchor Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    graveSpell(graveSpell1Code, "Widow Anchor Grave Spell 1"),
    graveSpell(graveSpell2Code, "Widow Anchor Grave Spell 2"),
    graveSpell(graveSpell3Code, "Widow Anchor Grave Spell 3"),
  ];
}

function graveSpell(code: string, name: string): DuelCardData {
  return { code, name, kind: "spell", typeFlags: typeSpell };
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
