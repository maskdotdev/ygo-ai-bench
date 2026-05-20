import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const verdictCode = "91969909";
const setTargetCode = "1001";
const selfBanishCode = "1002";
const valkyrieCode = "1003";
const setValkyrie = 0x122;
const typeMonster = 0x1;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Goddess Urd's Verdict announce target banish", () => {
  it("restores announce-card target param, facedown confirmation, matching target banish, and Valkyrie protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${verdictCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_VALKYRIE))");
    expect(script).toContain("e1:SetValue(aux.indoval)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e2:SetValue(aux.tgoval)");
    expect(script).toContain("e3:SetCategory(CATEGORY_REMOVE)");
    expect(script).toContain("Duel.AnnounceCard(tp)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.AND(Card.IsFacedown,Card.IsAbleToRemove),tp,0,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetTargetParam(ac)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_REMOVE,g+Duel.GetFieldGroup(tp,LOCATION_ONFIELD,0),1,tp,0)");
    expect(script).toContain("local ac=Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.ConfirmCards(tp,tc)");
    expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === verdictCode),
      { code: setTargetCode, name: "Urd Verdict Set Match", kind: "spell", typeFlags: typeSpell, attack: 0, defense: 0 },
      { code: selfBanishCode, name: "Urd Verdict Self Fallback", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: valkyrieCode, name: "Urd Verdict Valkyrie", kind: "monster", typeFlags: typeMonster, setcodes: [setValkyrie], level: 4, attack: 1400, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 91969909, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [verdictCode, selfBanishCode, valkyrieCode] }, 1: { main: [setTargetCode] } });
    startDuel(session);

    const verdict = requireCard(session, verdictCode);
    const setTarget = requireCard(session, setTargetCode);
    const selfBanish = requireCard(session, selfBanishCode);
    const valkyrie = requireCard(session, valkyrieCode);
    moveFaceUpSpell(session, verdict.uid, 0);
    moveFaceUpMonster(session, selfBanish.uid, 0);
    moveFaceUpMonster(session, valkyrie.uid, 0);
    moveSetSpell(session, setTarget.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(verdictCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === verdict.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      {
        code: 1002,
        event: "ignition",
        range: ["hand", "spellTrapZone"],
        targetRange: undefined,
        luaTargetDescriptor: undefined,
        luaValueDescriptor: undefined,
      },
      {
        code: 41,
        event: "continuous",
        range: ["spellTrapZone"],
        targetRange: [4, 0],
        luaTargetDescriptor: "target:setcode:290",
        luaValueDescriptor: "indestructible:opponent",
      },
      {
        code: 71,
        event: "continuous",
        range: ["spellTrapZone"],
        targetRange: [4, 0],
        luaTargetDescriptor: "target:setcode:290",
        luaValueDescriptor: "cannot-be-effect-target:opponent",
      },
      {
        code: undefined,
        event: "ignition",
        range: ["spellTrapZone"],
        targetRange: undefined,
        luaTargetDescriptor: undefined,
        luaValueDescriptor: undefined,
      },
    ]);

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === verdict.uid && action.effectId === "lua-4");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(setTargetCode), Number(selfBanishCode), Number(valkyrieCode), Number(verdictCode)], descriptions: [Number(setTargetCode), Number(selfBanishCode), Number(valkyrieCode), Number(verdictCode)], returned: Number(setTargetCode) },
    ]);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === setTarget.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: verdict.uid,
      reasonEffectId: 4,
    });
    expect(restored.session.state.cards.find((card) => card.uid === selfBanish.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === valkyrie.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "banished"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: setTarget.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [setTarget.uid],
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: setTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: verdict.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function moveFaceUpSpell(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "spellTrapZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  return card;
}

function moveSetSpell(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "spellTrapZone", controller);
  card.faceUp = false;
  card.position = "faceDown";
  return card;
}

function moveFaceUpMonster(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  return card;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
