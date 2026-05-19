import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const spellShatteringArrowCode = "93260132";
const faceUpSpellCode = "93260133";
const secondFaceUpSpellCode = "93260134";
const facedownSpellCode = "93260135";
const monsterDecoyCode = "93260136";
const responderCode = "93260137";
const typeSpell = 0x2;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Spell Shattering Arrow group destroy damage", () => {
  it("restores its opponent face-up Spell group destruction and destroyed-count damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${spellShatteringArrowCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsFaceup() and c:IsSpell()");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,0,LOCATION_ONFIELD,1,nil)");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_ONFIELD,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,sg,#sg,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,#sg*500)");
    expect(script).toContain("local ct=Duel.Destroy(sg,REASON_EFFECT)");
    expect(script).toContain("Duel.Damage(1-tp,ct*500,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === spellShatteringArrowCode),
      { code: faceUpSpellCode, name: "Spell Shattering Arrow Face-up Spell", kind: "spell", typeFlags: typeSpell },
      { code: secondFaceUpSpellCode, name: "Spell Shattering Arrow Second Face-up Spell", kind: "spell", typeFlags: typeSpell },
      { code: facedownSpellCode, name: "Spell Shattering Arrow Facedown Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: monsterDecoyCode, name: "Spell Shattering Arrow Monster Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Spell Shattering Arrow Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 93260132, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [spellShatteringArrowCode] },
      1: { main: [faceUpSpellCode, secondFaceUpSpellCode, facedownSpellCode, monsterDecoyCode, responderCode] },
    });
    startDuel(session);

    const arrow = requireCard(session, spellShatteringArrowCode);
    const faceUpSpell = requireCard(session, faceUpSpellCode);
    const secondFaceUpSpell = requireCard(session, secondFaceUpSpellCode);
    const facedownSpell = requireCard(session, facedownSpellCode);
    const monsterDecoy = requireCard(session, monsterDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, arrow.uid, "hand", 0);
    const firstSpell = moveDuelCard(session.state, faceUpSpell.uid, "spellTrapZone", 1);
    firstSpell.position = "faceUpAttack";
    firstSpell.faceUp = true;
    const secondSpell = moveDuelCard(session.state, secondFaceUpSpell.uid, "spellTrapZone", 1);
    secondSpell.position = "faceUpAttack";
    secondSpell.faceUp = true;
    const setSpell = moveDuelCard(session.state, facedownSpell.uid, "spellTrapZone", 1);
    setSpell.position = "faceDown";
    setSpell.faceUp = false;
    const movedMonster = moveDuelCard(session.state, monsterDecoy.uid, "monsterZone", 1);
    movedMonster.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spellShatteringArrowCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activateArrow = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === arrow.uid);
    expect(activateArrow, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activateArrow!);
    const destroyedSpellUids = [faceUpSpell.uid, secondFaceUpSpell.uid];
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [
        { category: 0x1, targetUids: destroyedSpellUids, count: 2, player: 0, parameter: 0 },
        { category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 1000 },
      ],
      player: 0,
      sourceUid: arrow.uid,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [
        { category: 0x1, targetUids: destroyedSpellUids, count: 2, player: 0, parameter: 0 },
        { category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 1000 },
      ],
      player: 0,
      sourceUid: arrow.uid,
    });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === arrow.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === faceUpSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: arrow.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === secondFaceUpSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: arrow.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === facedownSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 1, faceUp: false });
    expect(restored.session.state.cards.find((card) => card.uid === monsterDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(7000);
    const destroyedEvents = restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed");
    expect(destroyedEvents.filter((event) => event.eventUids === undefined).map((event) => event.eventCardUid)).toEqual(destroyedSpellUids);
    expect(destroyedEvents.filter((event) => event.eventUids !== undefined)).toMatchObject([
      {
        eventName: "destroyed",
        eventCardUid: faceUpSpell.uid,
        eventUids: destroyedSpellUids,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: arrow.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: arrow.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(host.messages).not.toContain("spell shattering arrow responder resolved");
    expect(restored.host.messages).not.toContain("spell shattering arrow responder resolved");

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.players[1].lifePoints).toBe(7000);
  });
});

function expectCleanRestore(restored: LuaSnapshotRestoreResult): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): void {
  const groups = getLuaRestoreLegalActionGroups(restored, player);
  const actions = getLuaRestoreLegalActions(restored, player);
  expect(actions).toEqual(getLegalActions(restored.session, player));
  expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(groups.flatMap((group) => group.actions)).toEqual(actions);
}

function applyRestoredActionAndAssert(restored: LuaSnapshotRestoreResult, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("spell shattering arrow responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
