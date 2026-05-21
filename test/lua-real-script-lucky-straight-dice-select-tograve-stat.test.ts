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
const luckyCode = "82308875";
const materialCode = "823088750";
const ownFieldCode = "823088751";
const opponentMonsterCode = "823088752";
const opponentSpellCode = "823088753";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLuckyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${luckyCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLuckyScript)("Lua real script Lucky Straight dice SelectEffect to-grave stat", () => {
  it("restores detach into two-dice final ATK and SelectEffect send-all-other-field-cards branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${luckyCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 79, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, ownFieldCode], extra: [luckyCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode] } });
    startDuel(session);

    const lucky = requireCard(session, luckyCode);
    const material = requireCard(session, materialCode);
    const ownField = requireCard(session, ownFieldCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    moveFaceUpAttack(session, lucky, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0).sequence = 0;
    lucky.overlayUids.push(material.uid);
    moveFaceUpAttack(session, ownField, 0);
    moveFaceUpAttack(session, opponentMonster, 1);
    moveFaceUpSpellTrap(session, opponentSpell, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const promptOverrides = [{ api: "SelectEffect" as const, player: 0 as const, returned: 1 }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(luckyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lucky.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectEffect",
        player: 0,
        options: [1, 2],
        returned: 1,
      }),
    ]));
    expect(restoredOpen.session.state.lastDiceResults).toEqual([3, 4]);
    expect(restoredOpen.session.state.randomCounter).toBe(2);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === lucky.uid), restoredOpen.session.state)).toBe(2800);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lucky.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      overlayUids: [],
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: lucky.uid,
      reasonEffectId: 2,
    });
    for (const sent of [ownField, opponentMonster, opponentSpell]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === sent.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: lucky.uid,
        reasonEffectId: 2,
      });
    }
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === lucky.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { count: 2, flags: 1107235328 }, sourceUid: lucky.uid, value: 2800 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "diceTossed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: material.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 2, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 2, previousLocation: "overlay", currentLocation: "graveyard" },
      { eventName: "diceTossed", eventCode: 1150, eventCardUid: undefined, eventPlayer: 0, eventValue: 2, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 2, previousLocation: undefined, currentLocation: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ownField.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentMonster.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentSpell.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 2, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ownField.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lucky.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,7,3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOGRAVE+CATEGORY_SPECIAL_SUMMON+CATEGORY_DRAW+CATEGORY_HANDES)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,2)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,nil,1,PLAYER_ALL,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,PLAYER_ALL,LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DRAW,nil,0,tp,3)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_HANDES,nil,0,tp,2)");
  expect(script).toContain("local d1,d2=Duel.TossDice(tp,2)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(d1*700)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsAbleToGrave,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,c)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.Draw(tp,3,REASON_EFFECT)");
  expect(script).toContain("Duel.DiscardHand(tp,nil,2,2,REASON_EFFECT|REASON_DISCARD)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === luckyCode),
    { code: materialCode, name: "Lucky Straight Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 1000, defense: 1000 },
    { code: ownFieldCode, name: "Lucky Straight Own Field Send", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
    { code: opponentMonsterCode, name: "Lucky Straight Opponent Monster Send", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1000 },
    { code: opponentSpellCode, name: "Lucky Straight Opponent Spell Send", kind: "spell", typeFlags: typeSpell },
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
