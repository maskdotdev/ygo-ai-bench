import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const launchCode = "30845999";
const normalQliCode = "308459990";
const specialQliCode = "308459991";
const nonQliCode = "308459992";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLaunchScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${launchCode}.lua`));
const setQli = 0xaa;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeEarth = 0x10;
const effectImmuneEffect = 1;
const effectDisable = 2;
const effectDisableEffect = 8;
const effectUpdateAttack = 100;
const effectFlagSingleRangeClientHint = 0x4020000;
const resetStandardPhaseEnd = 1107169792;
const resetTurnSet = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLaunchScript)("Lua real script Qlipper Launch normal summoned bundle", () => {
  it("restores normal-summoned Qli group ATK, disable, disable-effect, and spell/trap immunity", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${launchCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const launch = requireCard(restored.session, launchCode);
    const normalQli = requireCard(restored.session, normalQliCode);
    const specialQli = requireCard(restored.session, specialQliCode);
    const nonQli = requireCard(restored.session, nonQliCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === launch.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, normalQli.uid), restored.session.state)).toBe(2100);
    expect(currentAttack(findCard(restored.session, specialQli.uid), restored.session.state)).toBe(1900);
    expect(currentAttack(findCard(restored.session, nonQli.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) =>
      [normalQli.uid, specialQli.uid, nonQli.uid].includes(effect.sourceUid)
        && [effectUpdateAttack, effectDisable, effectDisableEffect, effectImmuneEffect].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, description: undefined, property: undefined, range: ["monsterZone"], reset: { flags: resetStandardPhaseEnd }, sourceUid: normalQli.uid, value: 300 },
      { code: effectDisable, description: undefined, property: undefined, range: ["monsterZone"], reset: { flags: resetStandardPhaseEnd }, sourceUid: normalQli.uid, value: undefined },
      { code: effectDisableEffect, description: undefined, property: undefined, range: ["monsterZone"], reset: { flags: resetStandardPhaseEnd }, sourceUid: normalQli.uid, value: resetTurnSet },
      { code: effectImmuneEffect, description: 3104, property: effectFlagSingleRangeClientHint, range: ["monsterZone"], reset: { flags: resetStandardPhaseEnd }, sourceUid: normalQli.uid, value: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const launch = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === launchCode);
  expect(launch).toBeDefined();
  return [
    { ...launch!, kind: "spell", typeFlags: typeSpell },
    { code: normalQliCode, name: "Qlipper Launch Normal Qli", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000, setcodes: [setQli] },
    { code: specialQliCode, name: "Qlipper Launch Special Qli", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000, setcodes: [setQli] },
    { code: nonQliCode, name: "Qlipper Launch Non-Qli", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 30845999, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [launchCode, normalQliCode, specialQliCode, nonQliCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, launchCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, normalQliCode), 0, 0).summonType = "normal";
  moveFaceUpAttack(session, requireCard(session, specialQliCode), 0, 1).summonType = "special";
  moveFaceUpAttack(session, requireCard(session, nonQliCode), 0, 2).summonType = "normal";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(launchCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Qlipper Launch");
  expect(script).toContain("s.listed_series={SET_QLI}");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_QLI) and c:IsNormalSummoned()");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("e3:SetValue(RESET_TURN_SET)");
  expect(script).toContain("e4:SetDescription(3104)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e4:SetCode(EFFECT_IMMUNE_EFFECT)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
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
