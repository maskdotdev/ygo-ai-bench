import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const alchemistCode = "78121572";
const targetCode = "781215720";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAlchemistScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alchemistCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeDark = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasAlchemistScript)("Lua real script Alchemist of Black Spells counter position", () => {
  it("restores targeted Spell Counter placement after changing itself to defense", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${alchemistCode}.lua`);
    expectScriptShape(script);
    const alchemistData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === alchemistCode);
    expect(alchemistData).toBeDefined();
    const reader = createCardReader([
      alchemistData!,
      { code: targetCode, name: "Alchemist Spell Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1200 },
    ]);

    const session = createDuel({ seed: 78121572, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alchemistCode, targetCode] }, 1: { main: [] } });
    startDuel(session);
    const alchemist = requireCard(session, alchemistCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, alchemist, 0);
    moveFaceUpAttack(session, target, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${targetCode}.lua`) return spellCounterTargetScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alchemistCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targetCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === alchemist.uid).map((effect) => ({
      category: effect.category,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { category: 0x800000, countLimit: 1, event: "ignition", id: "lua-1", range: ["monsterZone"] },
    ]);

    const ignition = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === alchemist.uid && action.effectId === "lua-1");
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, ignition!);

    expect(findCard(restored.session, alchemist.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
    });
    expect(getDuelCardCounter(findCard(restored.session, target.uid), counterSpell)).toBe(1);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "positionChanged", "counterAdded"].includes(event.eventName)).map((event) => eventSummary(event))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "positionChanged", eventCode: 1016, eventCardUid: alchemist.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1 },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(getLuaRestoreLegalActions(restoredResolved, 0).some((action) => action.type === "activateEffect" && action.uid === alchemist.uid)).toBe(false);
    expect(getDuelCardCounter(findCard(restoredResolved.session, target.uid), counterSpell)).toBe(1);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Alchemist of Black Spells");
  expect(script).toContain("s.counter_list={COUNTER_SPELL}");
  expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_ATTACK)");
  expect(script).toContain("return c:IsFaceup() and c:IsCanAddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: 0 | 1): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function spellCounterTargetScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(COUNTER_SPELL)
    end
  `;
}

function eventSummary(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonPlayer?: 0 | 1; eventReasonCardUid?: string; eventReasonEffectId?: number }) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}
