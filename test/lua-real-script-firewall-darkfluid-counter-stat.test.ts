import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const darkfluidCode = "68934651";
const fusionCode = "689346510";
const synchroCode = "689346511";
const xyzCode = "689346512";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDarkfluidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkfluidCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeSynchro = 0x2000;
const typeXyz = 0x800000;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const counterFirewall = 0x14c;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasDarkfluidScript)("Lua real script Firewall Dragon Darkfluid counter stat", () => {
  it("restores Firewall Counter state into battle-phase ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkfluidCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restored = createRestoredBattleState(reader, workspace);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const darkfluid = requireCard(restored.session, darkfluidCode);
    expect(getDuelCardCounter(findCard(restored.session, darkfluid.uid), counterFirewall)).toBe(3);
    expect(currentAttack(findCard(restored.session, darkfluid.uid), restored.session.state)).toBe(10500);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === darkfluid.uid && [0x10000 + counterFirewall, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 0x10000 + counterFirewall, event: "continuous", range: ["monsterZone"], value: 4 },
      { code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], value: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const darkfluid = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === darkfluidCode);
  expect(darkfluid).toBeDefined();
  return [
    darkfluid!,
    { code: fusionCode, name: "Darkfluid Cyberse Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: synchroCode, name: "Darkfluid Cyberse Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceCyberse, attribute: attributeDark, level: 7, attack: 2500, defense: 2000 },
    { code: xyzCode, name: "Darkfluid Cyberse Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2000, defense: 2000 },
  ];
}

function createRestoredBattleState(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 68934651, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [darkfluidCode, fusionCode, synchroCode, xyzCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerDarkfluid(session, workspace);
  const darkfluid = requireCard(session, darkfluidCode);
  const moved = moveDuelCard(session.state, darkfluid.uid, "monsterZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.summonType = "link";
  moved.counters = { [counterFirewall]: 3 };
  for (const code of [fusionCode, synchroCode, xyzCode]) {
    moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0);
  }
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerDarkfluid(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(darkfluidCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Firewall Dragon Darkfluid");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_FW)");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("Duel.GetMatchingGroup(s.ctfilter,tp,LOCATION_GRAVE,0,nil)");
  expect(script).toContain("c:AddCounter(COUNTER_FW,getcount(tp))");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return Duel.IsBattlePhase()");
  expect(script).toContain("return c:GetCounter(COUNTER_FW)*2500");
  expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
  expect(script).toContain("EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL");
  expect(script).toContain("Duel.IsChainNegatable(ev)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_FW,1,REASON_COST)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.ChainAttack()");
  expect(script).toContain("e1:SetCode(EVENT_DAMAGE_STEP_END)");
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
