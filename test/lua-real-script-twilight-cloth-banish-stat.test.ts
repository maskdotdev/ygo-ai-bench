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
const twilightClothCode = "83747250";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTwilightClothScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${twilightClothCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setLightsworn = 0x38;

describe.skipIf(!hasUpstreamScripts || !hasTwilightClothScript)("Lua real script Twilight Cloth banish stat", () => {
  it("restores target stat boost from selected Lightsworn field and grave banish count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "837472500";
    const fieldLightswornCode = "837472501";
    const graveLightswornCode = "837472502";
    const script = workspace.readScript(`official/c${twilightClothCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("return c:IsSetCard(SET_LIGHTSWORN) and c:IsMonster() and c:IsAbleToRemove() and aux.SpElimFilter(c,true)");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter2,tp,LOCATION_MZONE,0,1,1,nil,g)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("local sg=g:Select(tp,1,#g,nil)");
    expect(script).toContain("local rc=Duel.Remove(sg,POS_FACEUP,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(200*rc)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_LIGHTSWORN))");

    const cards: DuelCardData[] = [
      { code: twilightClothCode, name: "Twilight Cloth", kind: "trap", typeFlags: typeTrap },
      { code: targetCode, name: "Twilight Cloth Stat Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: fieldLightswornCode, name: "Twilight Field Lightsworn", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLightsworn], level: 4, attack: 1700, defense: 1000 },
      { code: graveLightswornCode, name: "Twilight Grave Lightsworn", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLightsworn], level: 4, attack: 1600, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 83747250, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [twilightClothCode, targetCode, fieldLightswornCode, graveLightswornCode] }, 1: { main: [] } });
    startDuel(session);

    const twilightCloth = requireCard(session, twilightClothCode);
    const target = requireCard(session, targetCode);
    const fieldLightsworn = requireCard(session, fieldLightswornCode);
    const graveLightsworn = requireCard(session, graveLightswornCode);
    moveDuelCard(session.state, twilightCloth.uid, "spellTrapZone", 0).faceUp = false;
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, fieldLightsworn, 0);
    moveDuelCard(session.state, graveLightsworn.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(twilightClothCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === twilightCloth.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === fieldLightsworn.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === graveLightsworn.uid)).toMatchObject({ location: "banished", controller: 0, faceUp: true });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1700);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1400);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveLightsworn.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: twilightCloth.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
