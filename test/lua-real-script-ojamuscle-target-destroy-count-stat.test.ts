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
const ojamuscleCode = "98259197";
const ojamaKingCode = "90140980";
const ownOjamaCode = "982591970";
const opponentOjamaCode = "982591971";
const nonOjamaCode = "982591972";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOjamuscleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ojamuscleCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const setOjama = 0xf;
const raceBeast = 0x4000;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasOjamuscleScript)("Lua real script Ojamuscle target destroy count stat", () => {
  it("restores Ojama King targeting into grouped Ojama destruction and count-based ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ojamuscleCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsCode(90140980)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_OJAMA),0,LOCATION_MZONE,LOCATION_MZONE,1,c)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_OJAMA),0,LOCATION_MZONE,LOCATION_MZONE,g:GetFirst())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,dg,#dg,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("local ct=Duel.Destroy(dg,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(ct*1000)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 98259197, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [ojamuscleCode, ojamaKingCode, ownOjamaCode, nonOjamaCode] },
      1: { main: [opponentOjamaCode] },
    });
    startDuel(session);
    const ojamuscle = requireCard(session, ojamuscleCode);
    const ojamaKing = requireCard(session, ojamaKingCode);
    const ownOjama = requireCard(session, ownOjamaCode);
    const opponentOjama = requireCard(session, opponentOjamaCode);
    const nonOjama = requireCard(session, nonOjamaCode);
    moveDuelCard(session.state, ojamuscle.uid, "hand", 0);
    moveFaceUpAttack(session, ojamaKing, 0, 0);
    moveFaceUpAttack(session, ownOjama, 0, 1);
    moveFaceUpAttack(session, nonOjama, 0, 2);
    moveFaceUpAttack(session, opponentOjama, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ojamuscleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ojamuscle.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(action)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restored, action!);
    passRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === ojamuscle.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === ojamaKing.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    for (const destroyed of [ownOjama, opponentOjama]) {
      expect(restored.session.state.cards.find((card) => card.uid === destroyed.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: ojamuscle.uid,
        reasonEffectId: 1,
      });
    }
    expect(restored.session.state.cards.find((card) => card.uid === nonOjama.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === ojamaKing.uid), restored.session.state)).toBe(5000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === ojamaKing.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, value: 2000 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ojamaKing.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownOjama.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ojamuscle.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ownOjama.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ojamuscle.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentOjama.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ojamuscle.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentOjama.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ojamuscle.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownOjama.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ojamuscle.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ojamuscle.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: ojamuscleCode, name: "Ojamuscle", kind: "spell", typeFlags: typeSpell },
    { code: ojamaKingCode, name: "Ojama King", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeast, attribute: attributeLight, level: 6, attack: 3000, defense: 3000, setcodes: [setOjama] },
    { code: ownOjamaCode, name: "Ojamuscle Own Ojama", kind: "monster", typeFlags: typeMonster, race: raceBeast, attribute: attributeLight, level: 2, attack: 0, defense: 1000, setcodes: [setOjama] },
    { code: opponentOjamaCode, name: "Ojamuscle Opponent Ojama", kind: "monster", typeFlags: typeMonster, race: raceBeast, attribute: attributeLight, level: 2, attack: 0, defense: 1000, setcodes: [setOjama] },
    { code: nonOjamaCode, name: "Ojamuscle Non-Ojama", kind: "monster", typeFlags: typeMonster, race: raceBeast, attribute: attributeLight, level: 4, attack: 1800, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
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
