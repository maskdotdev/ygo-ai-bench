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
const magicGateCode = "49941059";
const spellcasterCodeA = "499410590";
const spellcasterCodeB = "499410591";
const targetCode = "499410592";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectIndestructableBattle = 42;
const effectFlagClientHint = 0x20000;
const effectFlagSingleRange = 0x4000000;
const resetEventStandard = 0x1fe1000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Magic Gate of Miracles position control protect", () => {
  it("restores SelectMatchingCard into battle-indestructible control after position change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${magicGateCode}.lua`);
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.ChangePosition(g,POS_FACEUP_DEFENSE,POS_FACEDOWN_DEFENSE)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.GetControl(g,tp)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");

    const cards: DuelCardData[] = [
      { code: magicGateCode, name: "Magic Gate of Miracles", kind: "spell", typeFlags: typeSpell },
      { code: spellcasterCodeA, name: "Gate Spellcaster A", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, race: raceSpellcaster, level: 4, attack: 1500, defense: 1200 },
      { code: spellcasterCodeB, name: "Gate Spellcaster B", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, race: raceSpellcaster, level: 4, attack: 1400, defense: 1300 },
      { code: targetCode, name: "Gate Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 49941059, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magicGateCode, spellcasterCodeA, spellcasterCodeB] }, 1: { main: [targetCode] } });
    startDuel(session);

    const magicGate = requireCard(session, magicGateCode);
    const spellcasterA = requireCard(session, spellcasterCodeA);
    const spellcasterB = requireCard(session, spellcasterCodeB);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, magicGate.uid, "hand", 0);
    moveFaceUpAttack(session, spellcasterA, 0);
    moveFaceUpAttack(session, spellcasterB, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magicGateCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === magicGate.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: magicGate.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectIndestructableBattle).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectIndestructableBattle,
        description: 3000,
        property: effectFlagSingleRange | effectFlagClientHint,
        range: ["monsterZone"],
        reset: { flags: resetEventStandard },
        sourceUid: target.uid,
        value: 1,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["positionChanged", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: magicGate.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: magicGate.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 2 },
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
