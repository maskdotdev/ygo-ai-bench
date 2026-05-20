import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const dirgeCode = "40971261";
const announcedSpellCode = "1000000";
const opponentMonsterCode = "1000001";
const typeMonster = 0x1;
const typeSpell = 0x2;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dirge of the Lost Dragon announce chain solved", () => {
  it("restores announced-card chain watchers into LP halving and End Phase self-send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dirgeCode}.lua`);
    expect(script).toContain("Duel.AnnounceCard(tp)");
    expect(script).toContain("Duel.SetTargetParam(ac)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ANNOUNCE,nil,0,tp,ANNOUNCE_CARD)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.AdjustInstantly(e:GetHandler())");
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e3:SetCode(EVENT_CHAIN_SOLVED)");
    expect(script).toContain("Duel.SetLP(rp,Duel.GetLP(rp)/2)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)");
    expect(script).toContain("e4:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dirgeCode),
      { code: announcedSpellCode, name: "Dirge Announced Spell", kind: "spell", typeFlags: typeSpell },
      { code: opponentMonsterCode, name: "Dirge Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 40971261, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dirgeCode, announcedSpellCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const dirge = requireCard(session, dirgeCode);
    const announcedSpell = requireCard(session, announcedSpellCode);
    const opponentMonster = requireCard(session, opponentMonsterCode, 1);
    moveDuelCard(session.state, dirge.uid, "hand", 0);
    moveDuelCard(session.state, announcedSpell.uid, "hand", 0);
    moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1);
    opponentMonster.faceUp = true;
    opponentMonster.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${announcedSpellCode}.lua`) return announcedSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dirgeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(announcedSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const dirgeActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dirge.uid);
    expect(dirgeActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, dirgeActivation!);
    expect(restoredOpen.host.promptDecisions).toContainEqual({
      id: "lua-prompt-1",
      api: "AnnounceCard",
      player: 0,
      options: [Number(announcedSpellCode), Number(opponentMonsterCode), Number(dirgeCode)],
      descriptions: [Number(announcedSpellCode), Number(opponentMonsterCode), Number(dirgeCode)],
      returned: Number(announcedSpellCode),
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === dirge.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === dirge.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 1002, event: "ignition", label: undefined, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { code: 1027, event: "continuous", label: undefined, range: ["spellTrapZone"], triggerEvent: "chaining" },
      { code: 1022, event: "continuous", label: undefined, range: ["spellTrapZone"], triggerEvent: "chainSolved" },
      { code: 41, event: "continuous", label: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);

    const announcedActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === announcedSpell.uid);
    expect(announcedActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, announcedActivation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.host.messages).toContain("dirge announced spell resolved");
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(4000);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === dirge.uid && effect.triggerEvent === "phaseEnd")).toEqual([
      expect.objectContaining({
        code: phaseEndEventCode,
        countLimit: 1,
        event: "continuous",
        range: ["spellTrapZone"],
        triggerCode: phaseEndEventCode,
        triggerEvent: "phaseEnd",
      }),
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["chaining", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "chaining",
        eventCode: 1027,
        eventPlayer: 0,
        eventCardUid: dirge.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chaining",
        eventCode: 1027,
        eventPlayer: 0,
        eventCardUid: announcedSpell.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 1 },
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 5,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 5,
      },
    ]);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    restoredEnd.session.state.phase = "main2";
    restoredEnd.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === dirge.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dirge.uid,
      reasonEffectId: 6,
    });
    expect(restoredEnd.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([
      { eventName: "phaseEnd", eventCode: phaseEndEventCode },
    ]);
  });
});

function announcedSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("dirge announced spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0) {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
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
