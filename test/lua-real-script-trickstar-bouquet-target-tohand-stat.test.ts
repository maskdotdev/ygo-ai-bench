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
const bouquetCode = "99890852";
const returnedTrickstarCode = "998908520";
const boostTargetCode = "998908521";
const opponentFaceupCode = "998908522";
const extraTrickstarDecoyCode = "998908523";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBouquetScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bouquetCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceFairy = 0x4;
const attributeLight = 0x10;
const setTrickstar = 0xfb;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBouquetScript)("Lua real script Trickstar Bouquet target to-hand stat", () => {
  it("returns a face-up main-deck Trickstar and boosts the other face-up target by its base ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bouquetCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 99890852, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bouquetCode, returnedTrickstarCode, boostTargetCode], extra: [extraTrickstarDecoyCode] }, 1: { main: [opponentFaceupCode] } });
    startDuel(session);

    const bouquet = requireCard(session, bouquetCode);
    const returnedTrickstar = requireCard(session, returnedTrickstarCode);
    const boostTarget = requireCard(session, boostTargetCode);
    const opponentFaceup = requireCard(session, opponentFaceupCode);
    const extraTrickstarDecoy = requireCard(session, extraTrickstarDecoyCode);
    moveDuelCard(session.state, bouquet.uid, "hand", 0);
    moveFaceUpMonster(session, returnedTrickstar, 0, 0);
    moveFaceUpMonster(session, boostTarget, 0, 1);
    moveFaceUpMonster(session, extraTrickstarDecoy, 0, 2);
    moveFaceUpMonster(session, opponentFaceup, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bouquetCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === bouquet.uid && candidate.effectId === "lua-1-1002"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, returnedTrickstar.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: bouquet.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, boostTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(findCard(restored.session, opponentFaceup.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(findCard(restored.session, extraTrickstarDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(currentAttack(findCard(restored.session, boostTarget.uid), restored.session.state)).toBe(3100);
    expect(currentAttack(findCard(restored.session, opponentFaceup.uid), restored.session.state)).toBe(1900);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === boostTarget.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: boostTarget.uid, value: 1600 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: returnedTrickstar.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: boostTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: returnedTrickstar.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: bouquet.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const bouquet = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === bouquetCode);
  expect(bouquet).toBeDefined();
  return [
    { ...bouquet!, kind: "spell", typeFlags: typeSpell },
    { code: returnedTrickstarCode, name: "Trickstar Bouquet Returned Main Deck Trickstar", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1600, defense: 1200, setcodes: [setTrickstar] },
    { code: boostTargetCode, name: "Trickstar Bouquet Boost Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: opponentFaceupCode, name: "Trickstar Bouquet Opponent Face-up", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 1200 },
    { code: extraTrickstarDecoyCode, name: "Trickstar Bouquet Extra Trickstar Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceFairy, attribute: attributeLight, level: 2, attack: 1800, defense: 0, setcodes: [setTrickstar] },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Trickstar Bouquet");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("c:IsFaceup() and c:IsSetCard(SET_TRICKSTAR) and not c:IsType(TYPE_FUSION|TYPE_SYNCHRO|TYPE_TOKEN|TYPE_XYZ|TYPE_LINK)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,c)");
  expect(script).toContain("local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("e:SetLabelObject(g:GetFirst())");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,g)");
  expect(script).toContain("local g=Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SendtoHand(hc,nil,REASON_EFFECT)~=0");
  expect(script).toContain("local sg=Duel.GetOperatedGroup()");
  expect(script).toContain("if not sg:IsExists(Card.IsLocation,1,nil,LOCATION_HAND) then return end");
  expect(script).toContain("local atk=hc:GetBaseAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
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

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
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
