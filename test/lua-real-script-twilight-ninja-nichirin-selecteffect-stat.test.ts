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
const nichirinCode = "40945356";
const discardCode = "409453560";
const targetCode = "409453561";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNichirinScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nichirinCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDark = 0x20;
const raceWarrior = 0x1;
const setNinja = 0x2b;

describe.skipIf(!hasUpstreamScripts || !hasNichirinScript)("Lua real script Twilight Ninja Nichirin SelectEffect stat", () => {
  it("restores damage-step quick metadata and resolves SelectEffect ATK branch through discard cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${nichirinCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };
    const session = createNichirinSession(reader, source, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const nichirin = requireCard(restored.session, nichirinCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === nichirin.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 1002, event: "quick", property: 16384, range: ["monsterZone"], sourceUid: nichirin.uid },
    ]);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === nichirin.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();

    const result = applyLuaRestoreResponse(restored, activate as DuelAction);
    expect(result.ok, result.error).toBe(true);
    const discard = requireCard(restored.session, discardCode);
    expect(restored.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect").map((prompt) => ({
      api: prompt.api,
      options: prompt.options,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectEffect", options: [1, 2], player: 0, returned: 2 }]);
    expect(currentAttack(nichirin, restored.session.state)).toBe(3300);
    expect(restored.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === nichirin.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 1024, reset: { flags: 1107169792 }, value: 1000 },
    ]);
  });
});

function createNichirinSession(
  reader: ReturnType<typeof createCardReader>,
  source: { readScript(name: string): string },
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): DuelSession {
  const session = createDuel({ seed: 40945356, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [nichirinCode, discardCode, targetCode] }, 1: { main: [] } });
  startDuel(session);
  const nichirin = requireCard(session, nichirinCode);
  const discard = requireCard(session, discardCode);
  const target = requireCard(session, targetCode);
  const movedNichirin = moveDuelCard(session.state, nichirin.uid, "monsterZone", 0);
  movedNichirin.faceUp = true;
  movedNichirin.position = "faceUpAttack";
  moveDuelCard(session.state, discard.uid, "hand", 0);
  const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 0);
  movedTarget.faceUp = true;
  movedTarget.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(nichirinCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function cards(): DuelCardData[] {
  return [
    ninja(nichirinCode, "Twilight Ninja Nichirin, the Chunin", 2300),
    ninja(discardCode, "Nichirin Ninja Discard", 800),
    ninja(targetCode, "Nichirin Ninja ATK Target", 1200),
  ];
}

function ninja(code: string, name: string, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceWarrior,
    attribute: attributeDark,
    setcodes: [setNinja],
    level: 6,
    attack,
    defense: 1000,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Twilight Ninja Nichirin, the Chunin");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_NINJA),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetValue(1000)");
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
