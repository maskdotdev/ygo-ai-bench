import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const camelumpKindCounts = { pzoneDefenseLossPiercingRestore: 1 } satisfies Record<CamelumpKind, number>;
type CamelumpKind = "pzoneDefenseLossPiercingRestore";

describe("Lua real Performapal Camelump restore coverage", () => {
  it("keeps Performapal Camelump's PZone DEF loss and pierce grant owned", () => {
    const file = "test/lua-real-script-performapal-camelump-pzone-pierce-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
    expect(text.includes("restoreComplete")).toBe(true);
    expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
    expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActions")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActionGroups")).toBe(true);
    expect(text.includes("getGroupedDuelLegalActions")).toBe(true);
    for (const snippet of [
      'const camelumpCode = "44481227"',
      "Performapal Camelump",
      "restores PZONE ignition into opponent DEF loss and targeted piercing grant",
      "Pendulum.AddProcedure(c)",
      "e2:SetRange(LOCATION_PZONE)",
      "e2:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "return Duel.IsAbleToEnterBP()",
      "return c:IsFaceup() and not c:IsHasEffect(EFFECT_PIERCE)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)",
      "e1:SetCode(EFFECT_UPDATE_DEFENSE)",
      "e1:SetValue(-800)",
      "e2:SetDescription(3208)",
      "e2:SetProperty(EFFECT_FLAG_CLIENT_HINT)",
      "e2:SetCode(EFFECT_PIERCE)",
      "currentDefense(restored.session.state.cards.find((card) => card.uid === opponentFaceup.uid), restored.session.state)).toBe(1000)",
      "currentDefense(restored.session.state.cards.find((card) => card.uid === opponentFaceupSecond.uid), restored.session.state)).toBe(1200)",
      "currentDefense(restored.session.state.cards.find((card) => card.uid === opponentFacedown.uid), restored.session.state)).toBe(2100)",
      "code: effectUpdateDefense",
      "code: effectPierce",
      'eventName === "becameTarget"',
      "relatedEffectId: 3",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Performapal Camelump fixture kind explicit", () => {
    expect(camelumpKindCounts).toEqual({ pzoneDefenseLossPiercingRestore: 1 });
  });
});
